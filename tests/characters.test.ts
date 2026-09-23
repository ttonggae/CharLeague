import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAtlas, drawAtlasFrame, animationScale, animationGroundOffset } from '../src/atlas.ts';
import { parseCharacter, loadRoster } from '../src/characters.ts';
import { Game, emptyInput } from '../src/game.ts';

const json = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('only hans is registered, and only its exported attack is playable', async () => {
  const index = await json('../public/assets/characters/index.json');
  assert.deepEqual(index.characters, ['hans']);
  const raw = await json('../public/assets/characters/hans/character.json');
  const hans = parseCharacter(raw, 'hans');
  assert.equal(hans.name, '한스');
  assert.equal(hans.portraitProvided, false);
  assert.deepEqual(raw.skills.map((skill: { skillId: string }) => skill.skillId), ['guard', 'crouch', 'jab']);
  assert.deepEqual(hans.moves.map(move => move.id), ['jab']);
  assert.equal(hans.moves[0].label, '베기');
  assert.equal(hans.moves[0].startup, 15);
  assert.equal(hans.moves[0].cooldown, 6);
  assert.equal(hans.moves[0].bodyAnimation, 'jab');
  assert.equal(hans.moves[0].effectAnimation, undefined);

  const game = new Game(hans, hans);
  assert.equal(game.player.hp, hans.maxHp);
  assert.equal(game.dummy.hp, hans.maxHp);
  game.update({ ...emptyInput(), right: true });
  assert.equal(game.player.x, 286 + hans.walkSpeed);
  game.update({ ...emptyInput(), attacks: [{ button: 'S', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack, null);
  game.update({ ...emptyInput(), attacks: [{ button: 'D', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack, null);
  game.player.x = 400; game.dummy.x = 455;
  game.update({ ...emptyInput(), attacks: [{ button: 'A', horizontal: 0, up: false, down: false }] });
  assert.equal(game.player.attack?.move.id, 'jab');
  for (let i = 0; i < 14; i++) game.update(emptyInput());
  assert.equal(game.dummy.hp, hans.maxHp - hans.moves[0].damage);
  game.restart();
  assert.equal(game.player.hp, hans.maxHp);
});

test('hans jab hits after 3 animation frames (15 ticks) and waits 6 ticks after recovery', async () => {
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
  for (let i = 0; i < 14; i++) game.update(emptyInput());
  assert.equal(game.player.attack, null);
  assert.equal(game.player.attackCooldownUntilTick, game.tick + 6);
  game.update(a());
  assert.equal(game.player.attack, null);
  for (let i = 0; i < 4; i++) game.update(emptyInput());
  assert.equal(game.player.attack, null);
  game.update(emptyInput());
  assert.equal(game.player.attack?.move.id, 'jab');
});

test('hans v3 atlas provides idle, guard, crouch, and jab body frames', async () => {
  const atlas = parseAtlas(await json('../public/assets/characters/hans/atlas.json'));
  assert.equal(atlas.schemaVersion, 3);
  assert.deepEqual(atlas.atlases.characters.map(page => page.file), ['characters_1.png']);
  assert.deepEqual(atlas.atlases.effects, []);
  assert.equal(atlas.characterAnimations.find(animation => animation.name === 'idle')?.frames.length, 12);
  for (const id of ['guard', 'crouch', 'jab']) assert.ok(atlas.characterAnimations.some(animation => animation.skillId === id && animation.frames.length > 0));
  const layoutAtlas = { definition: atlas, characters: new Map(), effects: new Map() };
  assert.equal(animationScale(layoutAtlas, 'idle', 92), 2);
  assert.equal(animationGroundOffset(layoutAtlas, 'idle', 2, 92), 64);
  const image = { id: 'hans original PNG' };
  const loaded = { definition: atlas, characters: new Map([['characters_1.png', image]]), effects: new Map() } as unknown as Parameters<typeof drawAtlasFrame>[1];
  const calls: unknown[][] = [], scales: unknown[][] = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale(...args: unknown[]) { scales.push(args); }, drawImage(...args: unknown[]) { calls.push(args); } } as unknown as CanvasRenderingContext2D;
  assert.equal(drawAtlasFrame(ctx, loaded, 'characters', 'jab', 0, 100, 200, -1, 2), true);
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
