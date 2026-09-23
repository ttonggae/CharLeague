import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyInput } from '../src/game.ts';
import type { Button } from '../src/data.ts';
import { attackEffectAnchor } from '../src/render.ts';

function advance(game: Game, count: number, input = emptyInput()) {
  for (let i = 0; i < count; i++) game.update({ ...input, taps: [], attacks: [] });
}
function press(game: Game, button: Button, horizontal: -1 | 0 | 1 = 0, up = false, down = false) {
  game.update({ ...emptyInput(), attacks: [{ button, horizontal, up, down }] });
}

test('fixed-tick movement, jump, gravity and floor collision', () => {
  const game = new Game(); game.setMode('idle');
  const start = game.player.x;
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.x, start + game.player.data.walkSpeed);
  game.update({ ...emptyInput(), up: true });
  assert.equal(game.player.state, 'jump');
  assert.ok(game.player.y < 442);
  advance(game, 50);
  assert.equal(game.player.y, 442);
  assert.equal(game.player.state, 'idle');
});

test('double tap dashes and ordinary walking does not', () => {
  const game = new Game(); game.setMode('idle');
  game.update({ ...emptyInput(), taps: [1], right: true });
  advance(game, 5);
  game.update({ ...emptyInput(), taps: [1], right: true });
  assert.ok(game.player.dashTicks > 0);
  assert.equal(game.player.vx, game.player.data.dashSpeed);
  advance(game, 10);
  game.update({ ...emptyInput(), taps: [1], right: true });
  assert.equal(game.player.dashTicks, 0);
  advance(game, 47);
  game.update({ ...emptyInput(), taps: [1], right: true });
  assert.equal(game.player.dashTicks, 0);
  game.update({ ...emptyInput(), taps: [1], right: true });
  assert.ok(game.player.dashTicks > 0);
});

test('direction commands and A-A-S select data-defined moves', () => {
  const game = new Game(); game.setMode('idle');
  press(game, 'A', 1);
  assert.equal(game.player.attack?.move.id, 'step');
  advance(game, 9);
  press(game, 'A');
  assert.equal(game.player.attack?.move.id, 'jab');
  advance(game, 9);
  press(game, 'S');
  assert.equal(game.player.attack?.move.id, 'chain');

  game.restart();
  press(game, 'S', 0, false, true);
  assert.equal(game.player.attack?.move.id, 'sweep');
  game.restart();
  press(game, 'D', 0, true);
  assert.equal(game.player.attack?.move.id, 'rising');
});

test('attack input is buffered for 15 ticks during recovery', () => {
  const game = new Game(); game.setMode('idle');
  press(game, 'D');
  advance(game, 43); // D has 50 ticks total. Input within the last 15 ticks can execute next.
  press(game, 'A');
  assert.equal(game.player.attack?.move.id, 'skill2');
  advance(game, 7);
  assert.equal(game.player.attack?.move.id, 'jab');
});

test('hit, block chip, knockback, KO and restart', () => {
  const game = new Game(); game.setMode('idle');
  game.player.x = 400; game.dummy.x = 455;
  press(game, 'A'); advance(game, 4);
  assert.equal(game.dummy.hp, 93);
  assert.ok(game.dummy.vx > 0);
  assert.equal(game.dummy.state, 'hurt');
  game.restart(); game.setMode('guard');
  game.player.x = 400; game.dummy.x = 455;
  press(game, 'A'); advance(game, 4);
  assert.equal(game.dummy.hp, 99);
  assert.equal(game.dummy.hurtTicks, 0);
  game.restart(); game.setMode('idle');
  game.player.x = 400; game.dummy.x = 455; game.dummy.hp = 5;
  press(game, 'A'); advance(game, 4);
  assert.equal(game.winner, 'player');
  assert.equal(game.dummy.state, 'ko');
  game.update({ ...emptyInput(), restart: true });
  assert.equal(game.winner, null);
  assert.equal(game.dummy.hp, 100);
});

test('dummy counter can be blocked with Shift', () => {
  const game = new Game(); game.setMode('attack');
  game.player.x = 400; game.dummy.x = 475;
  advance(game, 125, { ...emptyInput(), guard: true });
  assert.equal(game.player.hp, 98);
  assert.equal(game.player.hurtTicks, 0);
});

test('movement changes facing, idle keeps it, and attacks/effects move to that side', () => {
  const game = new Game(); game.setMode('idle');
  const move = game.player.data.moves.find(candidate => candidate.id === 'jab')!;
  game.update({ ...emptyInput(), left: true });
  assert.equal(game.player.facing, -1);
  const leftAnchor = attackEffectAnchor(game.player, move);
  assert.ok(leftAnchor.x < game.player.x);
  game.update(emptyInput());
  assert.equal(game.player.facing, -1);
  game.player.x = 400; game.dummy.x = 345;
  press(game, 'A'); advance(game, 4);
  assert.equal(game.dummy.hp, 93);
  game.restart(); game.setMode('idle');
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.facing, 1);
  const rightAnchor = attackEffectAnchor(game.player, move);
  assert.ok(rightAnchor.x > game.player.x);
  game.update(emptyInput());
  assert.equal(game.player.facing, 1);
  const beforeTap = game.player.x;
  game.update({ ...emptyInput(), taps: [-1] });
  assert.equal(game.player.facing, -1);
  assert.equal(game.player.x, beforeTap - game.player.data.walkSpeed);
});
