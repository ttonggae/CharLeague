import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyInput } from '../src/game.ts';
import { playerData, SKILL_IDS, STAGE, STAMINA_REGEN_DELAY, type Button } from '../src/data.ts';
import { KEY_ACTION_IDS } from '../src/input.ts';
import { attackEffectAnchor } from '../src/render.ts';

function advance(game: Game, count: number, input = emptyInput()) {
  for (let i = 0; i < count; i++) game.update({ ...input, attacks: [] });
}
function press(game: Game, button: Button, horizontal: -1 | 0 | 1 = 0, up = false, down = false) {
  game.update({ ...emptyInput(), attacks: [{ button, horizontal, up, down }] });
}

test('only arrows and the five unified skill keys are mapped', () => {
  assert.deepEqual(KEY_ACTION_IDS, {
    ArrowLeft: 'move_left', ArrowRight: 'move_right', ArrowUp: 'jump', ArrowDown: 'drop',
    KeyA: 'A', KeyS: 'S', KeyD: 'D', ShiftLeft: 'Shift', ShiftRight: 'Shift', Space: 'Space'
  });
  assert.deepEqual(SKILL_IDS, ['A', 'S', 'D', 'Shift', 'Space']);
  for (const removed of ['KeyR', 'KeyC', 'Digit1', 'Digit2', 'Digit3']) assert.equal(KEY_ACTION_IDS[removed], undefined);
});

test('fixed-tick movement, jump, gravity and floor collision remain; down does not crouch', () => {
  const game = new Game(); game.setMode('idle');
  const start = game.player.x;
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.x, start + game.player.data.walkSpeed);
  game.update({ ...emptyInput(), down: true });
  assert.equal(game.player.state, 'idle');
  assert.equal(game.player.vx, 0);
  game.update({ ...emptyInput(), up: true });
  assert.equal(game.player.state, 'jump');
  assert.ok(game.player.y < STAGE.floor);
  advance(game, 50);
  assert.equal(game.player.y, STAGE.floor);
  assert.equal(game.player.state, 'idle');
});

test('movement animation starts at frame zero and advances from its own state clock', () => {
  const game = new Game(); game.setMode('idle');
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.state, 'move');
  assert.equal(game.player.stateTick, 0);
  advance(game, 5, { ...emptyInput(), right: true });
  assert.equal(game.player.stateTick, 5);
  game.update(emptyInput());
  assert.equal(game.player.state, 'idle');
  assert.equal(game.player.stateTick, 0);
});

test('A, S, D and Shift resolve to data-defined skills with matching IDs', () => {
  for (const button of SKILL_IDS.filter(button => button !== 'Space')) {
    const game = new Game(); game.setMode('idle');
    press(game, button);
    assert.equal(game.player.attack?.move.id, button);
    assert.equal(game.player.guarding, false);
  }
});

test('skills spend stamina, regenerate it, and wait in the input buffer when stamina is insufficient', () => {
  const game = new Game(); game.setMode('idle');
  press(game, 'S');
  assert.equal(game.player.attack?.move.id, 'S');
  assert.equal(game.player.stamina, 80);
  assert.equal(game.player.staminaRegenDelayTicks, STAMINA_REGEN_DELAY - 1);
  advance(game, STAMINA_REGEN_DELAY - 1);
  assert.equal(game.player.stamina, 80);
  advance(game, 1);
  assert.equal(game.player.stamina, 80.2);
  game.restart(); game.setMode('idle'); game.player.stamina = 5;
  press(game, 'D');
  assert.equal(game.player.attack, null);
  assert.ok(game.player.stamina > 5);
  advance(game, 14);
  assert.equal(game.player.attack, null);
});

test('passive events and ultimate conditions are data-driven; ultimate use resets progress', () => {
  const game = new Game(); game.setMode('idle');
  game.player.stamina = 80;
  for (let hit = 1; hit <= 3; hit++) {
    game.player.x = 400; game.dummy.x = 455;
    press(game, 'A'); advance(game, 18);
    assert.equal(game.player.ultimateProgress, hit);
  }
  assert.equal(game.player.stamina, 65, 'hit passive restores stamina immediately while natural regeneration remains delayed');
  press(game, 'Space');
  assert.equal(game.player.attack?.move.id, 'Space');
  assert.equal(game.player.ultimateProgress, 0);
});

test('Space works as a regular skill when the character has no ultimate config', () => {
  const ordinary = structuredClone(playerData);
  delete ordinary.ultimate;
  const game = new Game(ordinary, ordinary); game.setMode('idle');
  press(game, 'Space');
  assert.equal(game.player.attack?.move.id, 'Space');
  assert.equal(game.player.ultimateProgress, 0);
});

test('attack input is buffered for 15 ticks during recovery', () => {
  const game = new Game(); game.setMode('idle');
  press(game, 'D');
  advance(game, 43);
  press(game, 'A');
  assert.equal(game.player.attack?.move.id, 'D');
  advance(game, 7);
  assert.equal(game.player.attack?.move.id, 'A');
});

test('hit, dummy block, knockback, KO and button restart', () => {
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
  game.restart();
  assert.equal(game.winner, null);
  assert.equal(game.dummy.hp, 100);
});

test('movement changes facing, idle keeps it, and attacks/effects move to that side', () => {
  const game = new Game(); game.setMode('idle');
  const move = game.player.data.moves.find(candidate => candidate.id === 'A')!;
  game.update({ ...emptyInput(), left: true });
  assert.equal(game.player.facing, -1);
  assert.ok(attackEffectAnchor(game.player, move).x < game.player.x);
  game.update(emptyInput());
  assert.equal(game.player.facing, -1);
  game.player.x = 400; game.dummy.x = 345;
  press(game, 'A'); advance(game, 4);
  assert.equal(game.dummy.hp, 93);
  game.restart(); game.setMode('idle');
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.facing, 1);
  assert.ok(attackEffectAnchor(game.player, move).x > game.player.x);
  game.update(emptyInput());
  assert.equal(game.player.facing, 1);
});
