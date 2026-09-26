import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAtlas, drawAtlasFrame, animationScale, animationGroundOffset } from '../src/atlas.ts';
import { parseCharacter, loadRoster } from '../src/characters.ts';
import { Game, emptyInput } from '../src/game.ts';
import { skillStatus } from '../src/render.ts';

const json = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('only hans is registered with five skills, critical passive, and a conditional projectile ultimate', async () => {
  const index = await json('../public/assets/characters/index.json');
  assert.deepEqual(index.characters, ['hans']);
  const raw = await json('../public/assets/characters/hans/character.json');
  const hans = parseCharacter(raw, 'hans');
  assert.equal(hans.name, '한스');
  assert.equal(hans.portraitProvided, false);
  assert.deepEqual(raw.skills.map((skill: { skillId: string }) => skill.skillId), ['Shift', 'A', 'S', 'Move', 'D', 'Space', 'P']);
  assert.deepEqual(hans.moves.map(move => move.id), ['A', 'S', 'D', 'Shift', 'Space']);
  assert.equal(hans.maxStamina, 100);
  assert.equal(hans.staminaRegen, 0.2);
  assert.equal(hans.passive.id, 'hans-critical');
  assert.deepEqual(hans.passive.effects, [{ type: 'bonusDamageAgainstState', state: 'stun', multiplier: 1.5 }]);
  assert.equal(hans.ultimate?.moveId, 'Space');
  assert.deepEqual(hans.ultimate?.condition, { type: 'landHits', target: 3 });
  assert.equal(hans.ultimate?.readyEffectAnimation, 'P');
  const slash = hans.moves.find(move => move.id === 'A')!;
  assert.deepEqual({ startup: slash.startup, active: slash.active, recovery: slash.recovery, cooldown: slash.cooldown,
    stamina: slash.staminaCost, damage: slash.damage, reach: slash.reach },
  { startup: 15, active: 5, recovery: 10, cooldown: 6, stamina: 10, damage: 10, reach: 56 });
  const shock = hans.moves.find(move => move.id === 'S')!;
  assert.deepEqual({ startup: shock.startup, cooldown: shock.cooldown, stamina: shock.staminaCost, damage: shock.damage,
    reach: shock.reach, height: shock.height, stun: shock.stunTicks, kind: shock.kind },
  { startup: 10, cooldown: 300, stamina: 15, damage: 5, reach: 60, height: 64, stun: 30, kind: 'area' });
  const thrust = hans.moves.find(move => move.id === 'D')!;
  assert.deepEqual({ startup: thrust.startup, cooldown: thrust.cooldown, reach: thrust.reach }, { startup: 10, cooldown: 120, reach: 90 });
  const guard = hans.moves.find(move => move.id === 'Shift')!;
  assert.deepEqual({ kind: guard.kind, drain: guard.guardStaminaPerSecond, reduction: guard.damageReduction }, { kind: 'guard', drain: 10, reduction: 0.25 });
  const ultimate = hans.moves.find(move => move.id === 'Space')!;
  assert.deepEqual(ultimate.projectile, { width: 90, height: 80, speed: 8, lifetime: 120 });
  assert.equal(ultimate.damage, 30);

  const game = new Game(hans, hans);
  assert.equal(game.player.hp, hans.maxHp);
  assert.equal(game.dummy.hp, hans.maxHp);
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.x, 286 + hans.walkSpeed);
  game.update({ ...emptyInput(), attacks: [{ button: 'S', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack?.move.id, 'S');
  game.restart();
  game.update({ ...emptyInput(), attacks: [{ button: 'D', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack?.move.id, 'D');
  game.restart();
  game.update({ ...emptyInput(), attacks: [{ button: 'Space', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack, null);
  game.player.x = 400; game.dummy.x = 455;
  game.update({ ...emptyInput(), attacks: [{ button: 'A', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack?.move.id, 'A');
  for (let i = 0; i < 14; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, hans.maxHp - slash.damage);
  game.restart();
  assert.equal(game.player.hp, hans.maxHp);
});

test('hans A skill hits after 3 animation frames (15 ticks) and waits 6 ticks after recovery', async () => {
  const hans = parseCharacter(await json('../public/assets/characters/hans/character.json'), 'hans');
  const game = new Game(hans, hans); game.setMode('idle');
  game.player.x = 400; game.dummy.x = 455;
  const a = () => ({ ...emptyInput(), attacks: [{ button: 'A' as const, horizontal: 0 as const, up: false, down: false }] });
  game.update(a());
  assert.equal(game.dummy.hp, hans.maxHp);
  for (let i = 0; i < 13; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, hans.maxHp);
  game.update(emptyInput());
  assert.equal(game.dummy.hp, hans.maxHp - hans.moves[0].damage);
  for (let i = 0; i < 15; i++) game.update(emptyInput());
  assert.equal(game.player.attack, null);
  assert.equal(game.player.cooldowns.A, game.tick + 6);
  game.update(a());
  assert.equal(game.player.attack, null);
  for (let i = 0; i < 4; i++) game.update(emptyInput());
  assert.equal(game.player.attack, null);
  game.update(emptyInput());
  assert.equal(game.player.attack?.move.id, 'A');
});

test('hans guard drains stamina and reduces incoming damage by 25 percent', async () => {
  const hans = parseCharacter(await json('../public/assets/characters/hans/character.json'), 'hans');
  const game = new Game(hans, hans);
  game.player.x = 400; game.dummy.x = 455;
  const guard = { ...emptyInput(), heldSkills: ['Shift' as const] };
  const thrust = { ...emptyInput(), attacks: [{ button: 'D' as const, horizontal: 0 as const, up: false, down: false }] };
  game.updateOnline(guard, thrust);
  for (let i = 0; i < 9; i++) game.updateOnline(guard, emptyInput());
  assert.equal(game.player.hp, 92);
  assert.equal(game.player.state, 'guard');
  assert.ok(game.player.stamina > 98.3 && game.player.stamina < 98.4);
});

test('S stuns, attacks against an active stun deal 50 percent more damage, and the third hit plays P', async () => {
  const hans = parseCharacter(await json('../public/assets/characters/hans/character.json'), 'hans');
  const game = new Game(hans, hans); game.setMode('idle');
  game.player.x = 400; game.dummy.x = 455;
  const use = (button: 'A' | 'S' | 'D' | 'Space') => game.update({ ...emptyInput(), attacks: [{ button, horizontal: 0, up: false, down: false }] });
  use('S');
  for (let i = 0; i < 9; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, 95);
  assert.equal(game.dummy.state, 'stun');
  assert.equal(game.dummy.stunTicks, 30);
  assert.equal(game.player.ultimateProgress, 1);
  for (let i = 0; i < 10; i++) game.update(emptyInput());
  use('A');
  for (let i = 0; i < 14; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, 80, 'A deals 15 damage while stun is still active');
  assert.equal(game.notice, 'CRITICAL · 15');
  assert.equal(game.player.ultimateProgress, 2);
  for (let i = 0; i < 15; i++) game.update(emptyInput());
  use('D');
  for (let i = 0; i < 9; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, 70);
  assert.equal(game.player.ultimateProgress, 3);
  assert.equal(game.player.ultimateReadyEffectTick, 0);

  for (let i = 0; i < 15; i++) game.update(emptyInput());
  game.dummy.x = 700;
  use('Space');
  assert.equal(game.player.ultimateProgress, 0);
  assert.equal(game.player.ultimateReadyEffectTick, null);
  for (let i = 0; i < 14; i++) game.update(emptyInput());
  assert.equal(game.projectiles.length, 1);
  for (let i = 0; i < 60 && game.dummy.hp === 70; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, 40);
  assert.equal(game.projectiles.length, 0);
});

test('in-game skill status distinguishes ready, cooldown, resource, condition, and active states', async () => {
  const hans = parseCharacter(await json('../public/assets/characters/hans/character.json'), 'hans');
  const game = new Game(hans, hans);
  const slash = hans.moves.find(move => move.id === 'A')!;
  const ultimate = hans.moves.find(move => move.id === 'Space')!;
  assert.deepEqual(skillStatus(game.player, slash, game.tick), { available: true, label: '사용 가능', remainingTicks: 0 });
  assert.equal(skillStatus(game.player, ultimate, game.tick).label, '조건 0/3');
  game.player.cooldowns.A = game.tick + 61;
  assert.deepEqual(skillStatus(game.player, slash, game.tick), { available: false, label: '쿨 1.1초', remainingTicks: 61 });
  game.player.cooldowns.A = 0; game.player.stamina = 0;
  assert.equal(skillStatus(game.player, slash, game.tick).label, '기력 부족');
  game.player.stamina = hans.maxStamina;
  game.update({ ...emptyInput(), attacks: [{ button: 'A', horizontal: 0, up: false, down: false }] });
  assert.equal(skillStatus(game.player, slash, game.tick).label, '사용 중');
});

test('hans v3 atlas provides all body, projectile, and ultimate-ready effect frames', async () => {
  const atlas = parseAtlas(await json('../public/assets/characters/hans/atlas.json'));
  assert.equal(atlas.schemaVersion, 3);
  assert.deepEqual(atlas.atlases.characters.map(page => page.file), ['characters_1.png']);
  assert.deepEqual(atlas.atlases.effects.map(page => page.file), ['effects_1.png']);
  assert.equal(atlas.characterAnimations.find(animation => animation.name === 'idle')?.frames.length, 12);
  assert.ok(atlas.characterAnimations.some(animation => animation.skillId === 'A' && animation.frames.length > 0));
  assert.ok(atlas.characterAnimations.some(animation => animation.skillId === 'S' && animation.frames.length > 0));
  assert.ok(atlas.characterAnimations.some(animation => animation.skillId === 'D' && animation.frames.length > 0));
  assert.ok(atlas.characterAnimations.some(animation => animation.skillId === 'Space' && animation.frames.length > 0));
  assert.ok(atlas.effectAnimations.some(animation => animation.skillId === 'Space' && animation.frames.length === 4));
  assert.ok(atlas.effectAnimations.some(animation => animation.skillId === 'P' && animation.frames.length === 8));
  assert.ok(atlas.characterAnimations.every(animation => !['guard', 'crouch', 'jab'].includes(animation.skillId ?? '')));
  const layoutAtlas = { definition: atlas, characters: new Map(), effects: new Map() };
  assert.equal(animationScale(layoutAtlas, 'idle', 92), 2);
  assert.equal(animationGroundOffset(layoutAtlas, 'idle', 2, 92), 64);
  const image = { id: 'hans original PNG' };
  const loaded = { definition: atlas, characters: new Map([['characters_1.png', image]]), effects: new Map() } as unknown as Parameters<typeof drawAtlasFrame>[1];
  const calls: unknown[][] = [], scales: unknown[][] = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale(...args: unknown[]) { scales.push(args); }, drawImage(...args: unknown[]) { calls.push(args); } } as unknown as CanvasRenderingContext2D;
  assert.equal(drawAtlasFrame(ctx, loaded, 'characters', 'A', 0, 100, 200, -1, 2), true);
  assert.equal(calls[0][0], image);
  assert.deepEqual(scales[0], [-1, 1]);
  assert.equal(ctx.imageSmoothingEnabled, false);
});

test('renderer selects the correct image across multiple atlas pages', () => {
  const frame = (file: string, order: number) => ({ order, atlas: file, rect: { x: 2, y: 3, width: 8, height: 9 }, originalSize: { width: 20, height: 20 }, trim: { x: 4, y: 5, width: 8, height: 9 }, pivot: { x: 10, y: 10 }, position: { x: 0, y: 0 } });
  const definition = parseAtlas({ schemaVersion: 2, atlases: { characters: [{ index: 0, file: 'characters_1.png', width: 20, height: 20 }, { index: 1, file: 'characters_2.png', width: 20, height: 20 }], effects: [{ index: 0, file: 'effects_1.png', width: 20, height: 20 }, { index: 1, file: 'effects_2.png', width: 20, height: 20 }] }, characterAnimations: [{ name: 'idle', frames: [frame('characters_1.png', 0), frame('characters_2.png', 1)] }], effectAnimations: [{ name: 'flash', frames: [frame('effects_1.png', 0), frame('effects_2.png', 1)] }] });
  const first = { id: 'first' }, second = { id: 'second' }, effectFirst = { id: 'effect-first' }, effectSecond = { id: 'effect-second' };
  const loaded = { definition, characters: new Map([['characters_1.png', first], ['characters_2.png', second]]), effects: new Map([['effects_1.png', effectFirst], ['effects_2.png', effectSecond]]) } as unknown as Parameters<typeof drawAtlasFrame>[1];
  const calls: unknown[][] = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) { calls.push(args); } } as unknown as CanvasRenderingContext2D;
  assert.equal(drawAtlasFrame(ctx, loaded, 'characters', 'idle', 5, 0, 0, 1), true);
  assert.equal(calls[0][0], second);
  assert.equal(drawAtlasFrame(ctx, loaded, 'effects', 'flash', 5, 0, 0, 1), true);
  assert.equal(calls[1][0], effectSecond);
});

test('a missing character or atlas does not prevent hans from loading', async () => {
  const hans = await json('../public/assets/characters/hans/character.json');
  const originalFetch = globalThis.fetch;
  const originalImage = globalThis.Image;
  const originalError = console.error;
  console.error = () => {};
  class MissingImage { set src(_url: string) { queueMicrotask(() => this.onerror?.()); } onerror: (() => void) | null = null; onload: (() => void) | null = null }
  globalThis.Image = MissingImage as unknown as typeof Image;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = String(input);
    if (path.endsWith('/index.json')) return new Response(JSON.stringify({ characters: ['hans', 'missing'] }), { status: 200 });
    if (path.endsWith('/hans/character.json')) return new Response(JSON.stringify(hans), { status: 200 });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  try {
    const roster = await loadRoster();
    assert.equal(roster.entries.length, 2);
    assert.equal(roster.entries[0].data?.name, '한스');
    assert.equal(roster.entries[0].atlas, null);
    assert.equal(roster.entries[0].portraitUrl, null);
    assert.ok(roster.entries[0].issues.some(issue => issue.includes('/hans/atlas.json')));
    assert.equal(roster.entries[1].data, null);
    assert.ok(roster.entries[1].issues.some(issue => issue.includes('/missing/character.json')));
    globalThis.fetch = (async (input: string | URL | Request) => String(input).endsWith('/index.json')
      ? new Response(JSON.stringify({ characters: ['missing'] }), { status: 200 })
      : new Response('', { status: 404 })) as typeof fetch;
    const fallback = await loadRoster();
    assert.equal(fallback.entries[0].id, 'fallback-player');
    assert.ok(fallback.issues.some(issue => issue.includes('/missing/character.json')));
  } finally { globalThis.fetch = originalFetch; globalThis.Image = originalImage; console.error = originalError; }
});
