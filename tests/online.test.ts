import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCharacter } from '../src/characters.ts';
import { Game, emptyInput } from '../src/game.ts';
import { OnlineMatch, packInput, unpackInput, validInputBits, parseInputPacket, parseSnapshotPacket, tokenFromFragment } from '../src/online.ts';
import type { InputFrame } from '../src/input.ts';

const hansRaw = JSON.parse(await readFile(new URL('../public/assets/characters/hans/character.json', import.meta.url), 'utf8'));
const hans = parseCharacter(hansRaw, 'hans');

test('packed input preserves movement and all five skill inputs', () => {
  const input: InputFrame = { ...emptyInput(), left: true, up: true,
    heldSkills: ['A', 'Shift'],
    attacks: [
      { button: 'A', horizontal: -1, up: true, down: false },
      { button: 'S', horizontal: 1, up: false, down: true },
      { button: 'D', horizontal: 0, up: false, down: false },
      { button: 'Shift', horizontal: -1, up: false, down: false },
      { button: 'Space', horizontal: 1, up: true, down: false }
    ] };
  assert.deepEqual(unpackInput(packInput(input)), input);
  assert.equal(validInputBits(2 ** 29), true);
  assert.equal(validInputBits(2 ** 34), false);
  assert.equal(parseInputPacket({ kind: 'input', frame: -1, bits: 0 }), null);
  assert.notEqual(parseInputPacket({ kind: 'input', frame: 4, bits: 2 ** 29 }), null);
  assert.equal(tokenFromFragment('#duel=' + 'a'.repeat(48)), 'a'.repeat(48));
  assert.equal(tokenFromFragment('#duel=short'), null);
});

test('two lockstep games exchange frame inputs and repair only after a hash mismatch', () => {
  const hostGame = new Game(hans, hans, 42), guestGame = new Game(hans, hans, 42);
  let host!: OnlineMatch, guest!: OnlineMatch;
  let snapshots = 0;
  host = new OnlineMatch(hostGame, 0, {
    sendInput: packet => guest.receiveInput(packet),
    sendHash: packet => guest.receiveHash(packet),
    sendSnapshot: packet => { snapshots++; guest.receiveSnapshot(packet); }
  });
  guest = new OnlineMatch(guestGame, 1, {
    sendInput: packet => host.receiveInput(packet),
    sendHash: packet => host.receiveHash(packet),
    sendSnapshot: () => assert.fail('P2 must not send snapshots')
  });
  for (let i = 0; i < 125; i++) {
    const p1 = { ...emptyInput(), right: i < 15, attacks: i === 30 ? [{ button: 'A' as const, horizontal: 0 as const, up: false, down: false }] : [] };
    const p2 = { ...emptyInput(), left: i < 15 };
    host.capture(p1); guest.capture(p2);
    host.advance(1); guest.advance(1);
    if (i === 68) guestGame.player.hp--;
  }
  assert.equal(host.frame, guest.frame);
  assert.equal(snapshots, 1);
  assert.deepEqual(guestGame.snapshot(), hostGame.snapshot());
  assert.equal(parseSnapshotPacket({ kind: 'snapshot', frame: host.frame, state: { ...hostGame.snapshot(), player: { ...hostGame.snapshot().player, hp: 999 } } }, hostGame), null);
  assert.equal(parseSnapshotPacket({ kind: 'snapshot', frame: host.frame, state: { ...hostGame.snapshot(), player: { ...hostGame.snapshot().player, stamina: 999 } } }, hostGame), null);
  assert.equal(parseSnapshotPacket({ kind: 'snapshot', frame: host.frame, state: { ...hostGame.snapshot(), player: { ...hostGame.snapshot().player, ultimateProgress: 999 } } }, hostGame), null);
  assert.equal(parseSnapshotPacket({ kind: 'snapshot', frame: host.frame, state: { ...hostGame.snapshot(), player: { ...hostGame.snapshot().player, cooldowns: { ...hostGame.snapshot().player.cooldowns, A: -1 } } } }, hostGame), null);
  assert.equal(parseSnapshotPacket({ kind: 'snapshot', frame: host.frame, state: { ...hostGame.snapshot(), roundWins: [3, 0] } }, hostGame), null);
});

test('online best of three holds each KO for 180 ticks and returns to selection after two wins', () => {
  const game = new Game(hans, hans, 77, true);
  const attack = { ...emptyInput(), attacks: [{ button: 'A' as const, horizontal: 0 as const, up: false, down: false }] };
  const winRound = (side: 0 | 1) => {
    game.player.x = 500; game.dummy.x = 550;
    if (side === 0) game.dummy.hp = 1;
    else game.player.hp = 1;
    game.updateOnline(side === 0 ? attack : emptyInput(), side === 1 ? attack : emptyInput());
    for (let i = 0; i < 70 && !game.winner; i++) game.updateOnline(emptyInput(), emptyInput());
    assert.equal(game.winner, side === 0 ? 'player' : 'dummy');
    const koTick = game.koTick!;
    for (let i = 0; i < 179; i++) game.updateOnline(emptyInput(), emptyInput());
    assert.equal(game.tick - koTick, 179);
    assert.ok(game.winner, 'KO remains visible until three seconds have elapsed');
    game.updateOnline(emptyInput(), emptyInput());
  };
  winRound(0);
  assert.equal(game.winner, null);
  assert.deepEqual(game.roundWins, [1, 0]);
  assert.equal(game.player.hp, hans.maxHp);
  assert.equal(game.dummy.hp, hans.maxHp);
  const restored = new Game(hans, hans, 77, true);
  restored.restore(game.snapshot());
  assert.deepEqual(restored.snapshot(), game.snapshot());

  winRound(1);
  assert.equal(game.winner, null);
  assert.deepEqual(game.roundWins, [1, 1]);
  winRound(0);
  assert.equal(game.seriesWinner, 'player');
  assert.deepEqual(game.roundWins, [2, 1]);
  assert.equal(game.winner, 'player');
});

test('both lockstep peers keep round scores and KO transitions in sync', () => {
  const hostGame = new Game(hans, hans, 98, true), guestGame = new Game(hans, hans, 98, true);
  let host!: OnlineMatch, guest!: OnlineMatch;
  host = new OnlineMatch(hostGame, 0, {
    sendInput: packet => guest.receiveInput(packet), sendHash: packet => guest.receiveHash(packet),
    sendSnapshot: packet => guest.receiveSnapshot(packet)
  });
  guest = new OnlineMatch(guestGame, 1, {
    sendInput: packet => host.receiveInput(packet), sendHash: packet => host.receiveHash(packet),
    sendSnapshot: () => assert.fail('only P1 repairs the state')
  });
  const attack = { ...emptyInput(), attacks: [{ button: 'A' as const, horizontal: 0 as const, up: false, down: false }] };
  const tick = (input = emptyInput()) => {
    host.capture(input); guest.capture(emptyInput()); host.advance(1); guest.advance(1);
  };
  for (let round = 0; round < 2; round++) {
    for (const game of [hostGame, guestGame]) { game.player.x = 500; game.dummy.x = 550; game.dummy.hp = 1; }
    tick(attack);
    for (let i = 0; i < 70 && !hostGame.winner; i++) tick();
    assert.equal(hostGame.winner, 'player');
    assert.deepEqual(guestGame.snapshot(), hostGame.snapshot());
    if (round === 0) guestGame.roundWins[0] = 0;
    for (let i = 0; i < 180; i++) tick();
    assert.deepEqual(guestGame.snapshot(), hostGame.snapshot());
    assert.deepEqual(hostGame.roundWins, [round + 1, 0]);
  }
  assert.equal(hostGame.seriesWinner, 'player');
  assert.equal(guestGame.seriesWinner, 'player');
  assert.equal(host.frame, guest.frame);
});
