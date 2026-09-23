import { hasAnimation, loadAtlas, type LoadedAtlas } from './atlas.ts';
import { ACTION_IDS, ANIMATION_FPS, ATTACK_IDS, TICK_RATE, dummyData, playerData, type Button, type CharacterData, type Direction, type MoveData } from './data.ts';

const ROOT = `${import.meta.env?.BASE_URL ?? '/'}assets/characters/`;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}: 비어 있거나 문자열이 아닙니다`);
  return value;
};
const number = (value: unknown, field: string, min = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${field}: ${min} 이상의 숫자가 필요합니다`);
  return value;
};
const ticks = (value: unknown, field: string, min = 0): number => {
  const result = number(value, field, min);
  if (!Number.isInteger(result)) throw new Error(`${field}: 정수 틱 수가 필요합니다`);
  return result;
};
const assetPath = (value: unknown, field: string): string => {
  const path = text(value, field);
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || /^[a-z]+:/i.test(path)) throw new Error(`${field}: 캐릭터 폴더 안의 상대 경로가 필요합니다`);
  return path;
};

export interface CharacterEntry {
  id: string;
  data: CharacterData | null;
  atlas: LoadedAtlas | null;
  portraitUrl: string | null;
  issues: string[];
}

export function parseCharacter(raw: unknown, id: string): CharacterData & { atlas: string; portrait: string } {
  if (!object(raw)) throw new Error('character.json: 객체가 필요합니다');
  if (raw.schemaVersion === 1) return parseStudioCharacter(raw, id);
  if (raw.id !== undefined && raw.id !== id) throw new Error(`character.json: id가 index.json의 ${id}와 다릅니다`);
  if (!Array.isArray(raw.moves) || raw.moves.length === 0) throw new Error('moves: 기술 배열이 필요합니다');
  const color = typeof raw.color === 'string' ? raw.color : '#8be8ff';
  const moves: MoveData[] = raw.moves.map((value, index) => {
    const prefix = `moves[${index}]`;
    if (!object(value)) throw new Error(`${prefix}: 객체가 필요합니다`);
    if (!Array.isArray(value.sequence) || value.sequence.length === 0 || !value.sequence.every(key => ['A', 'S', 'D'].includes(key))) throw new Error(`${prefix}.sequence: A/S/D 배열이 필요합니다`);
    if (!['any', 'forward', 'back', 'up', 'down'].includes(String(value.direction))) throw new Error(`${prefix}.direction: 올바르지 않습니다`);
    if (!object(value.knockback)) throw new Error(`${prefix}.knockback: x/y가 필요합니다`);
    const moveId = text(value.id, `${prefix}.id`);
    if (value.effect !== undefined && value.effect !== moveId) throw new Error(`${prefix}.effect: 기술 ID ${moveId}와 같아야 합니다`);
    return {
      id: moveId, label: text(value.label, `${prefix}.label`),
      sequence: value.sequence as Button[], direction: value.direction as Direction,
      startup: number(value.startup, `${prefix}.startup`), active: number(value.active, `${prefix}.active`, 1),
      recovery: number(value.recovery, `${prefix}.recovery`),
      cooldown: value.cooldown === undefined ? 0 : ticks(value.cooldown, `${prefix}.cooldown`),
      damage: number(value.damage, `${prefix}.damage`),
      chip: number(value.chip ?? 0, `${prefix}.chip`),
      knockback: { x: number(value.knockback.x, `${prefix}.knockback.x`), y: number(value.knockback.y, `${prefix}.knockback.y`, -100) },
      hitstun: number(value.hitstun, `${prefix}.hitstun`), reach: number(value.reach, `${prefix}.reach`, 1),
      height: number(value.height, `${prefix}.height`, 1), effect: moveId,
      color: typeof value.color === 'string' ? value.color : color,
      bodyAnimation: typeof value.bodyAnimation === 'string' ? value.bodyAnimation : undefined,
      bodyAnimationMode: (value.bodyAnimationMode === 'overlay' ? 'overlay' : 'replace') as MoveData['bodyAnimationMode'],
      effectAnimation: typeof value.effectAnimation === 'string' ? value.effectAnimation : undefined
    };
  }).sort((a, b) => b.sequence.length - a.sequence.length || Number(b.direction !== 'any') - Number(a.direction !== 'any'));
  return {
    id, name: text(raw.name, 'name'), description: text(raw.description, 'description'), color,
    portraitProvided: raw.portraitProvided !== false,
    maxHp: number(raw.maxHp, 'maxHp', 1), walkSpeed: number(raw.walkSpeed, 'walkSpeed'),
    jumpSpeed: number(raw.jumpSpeed, 'jumpSpeed'), dashSpeed: number(raw.dashSpeed, 'dashSpeed'),
    width: number(raw.width, 'width', 1), height: number(raw.height, 'height', 1),
    spriteScale: raw.spriteScale === undefined ? undefined : number(raw.spriteScale, 'spriteScale', 0.01),
    dummyMoveId: typeof raw.dummyMoveId === 'string' ? raw.dummyMoveId : undefined,
    atlas: assetPath(raw.atlas, 'atlas'), portrait: assetPath(raw.portrait, 'portrait'), moves
  };
}

function parseStudioCharacter(raw: Record<string, unknown>, id: string): CharacterData & { atlas: string; portrait: string } {
  if (raw.characterId !== id) throw new Error(`character.json: characterId가 index.json의 ${id}와 다릅니다`);
  if (!Array.isArray(raw.skills)) throw new Error('skills: 배열이 필요합니다');
  const ticksPerAnimationFrame = raw.ticksPerAnimationFrame === undefined
    ? TICK_RATE / ANIMATION_FPS : ticks(raw.ticksPerAnimationFrame, 'ticksPerAnimationFrame', 1);
  const links = new Map<string, { body?: string; effect?: string; label?: string; startup?: number; active?: number; recovery?: number; cooldown?: number }>();
  raw.skills.forEach((skill, index) => {
    if (!object(skill)) throw new Error(`skills[${index}]: 객체가 필요합니다`);
    const skillId = text(skill.skillId, `skills[${index}].skillId`);
    if (!ATTACK_IDS.some(id => id === skillId) && skillId !== ACTION_IDS.guard && skillId !== ACTION_IDS.crouch) throw new Error(`skills[${index}].skillId: 등록되지 않은 조작 ID ${skillId}`);
    if (links.has(skillId)) throw new Error(`skills[${index}].skillId: 중복된 조작 ID ${skillId}`);
    if (skill.startup !== undefined && skill.startupFrames !== undefined) throw new Error(`skills[${index}]: startup과 startupFrames를 동시에 쓸 수 없습니다`);
    const body = Array.isArray(skill.characterAnimations) ? skill.characterAnimations[0] : null;
    const effect = Array.isArray(skill.effectAnimations) ? skill.effectAnimations[0] : null;
    links.set(skillId, {
      body: object(body) ? skillId : undefined,
      effect: object(effect) ? skillId : undefined,
      label: object(body) && typeof body.name === 'string' && body.name.trim() ? body.name : undefined,
      startup: skill.startupFrames !== undefined
        ? ticks(skill.startupFrames, `skills[${index}].startupFrames`) * ticksPerAnimationFrame
        : skill.startup === undefined ? undefined : ticks(skill.startup, `skills[${index}].startup`),
      active: skill.active === undefined ? undefined : ticks(skill.active, `skills[${index}].active`, 1),
      recovery: skill.recovery === undefined ? undefined : ticks(skill.recovery, `skills[${index}].recovery`),
      cooldown: skill.cooldown === undefined ? undefined : ticks(skill.cooldown, `skills[${index}].cooldown`)
    });
  });
  const moves = playerData.moves.filter(move => links.has(move.id)).map(move => {
    const link = links.get(move.id)!;
    return { ...move, label: link.label ?? move.label, bodyAnimation: link.body, effectAnimation: link.effect,
      startup: link.startup ?? move.startup, active: link.active ?? move.active,
      recovery: link.recovery ?? move.recovery, cooldown: link.cooldown ?? 0 };
  });
  return {
    ...playerData,
    id,
    name: text(raw.displayName, 'displayName'),
    description: typeof raw.description === 'string' ? raw.description : 'Atlas Studio 캐릭터',
    portraitProvided: raw.portraitProvided !== false,
    dummyMoveId: moves[0]?.id,
    atlas: assetPath(raw.atlas, 'atlas'),
    portrait: assetPath(raw.portrait, 'portrait'),
    moves
  };
}

function error(entry: CharacterEntry, message: string): void {
  entry.issues.push(message);
  console.error(`[캐릭터 ${entry.id}] ${message}`);
}

function checkImage(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

async function loadOne(id: string): Promise<CharacterEntry> {
  const entry: CharacterEntry = { id, data: null, atlas: null, portraitUrl: null, issues: [] };
  const base = `${ROOT}${id}/`;
  let definition: CharacterData & { atlas: string; portrait: string };
  try {
    const path = `${base}character.json`;
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error('파일이 없거나 JSON 대신 HTML이 반환됐습니다');
    definition = parseCharacter(await response.json(), id);
    entry.data = definition;
  } catch (cause) {
    error(entry, `${base}character.json: ${cause instanceof Error ? cause.message : String(cause)}`);
    return entry;
  }
  const atlasPath = `${base}${definition.atlas}`;
  const portraitPath = `${base}${definition.portrait}`;
  const [atlas, portraitExists] = await Promise.all([
    loadAtlas(atlasPath, message => error(entry, message)),
    definition.portraitProvided === false ? Promise.resolve(false) : checkImage(portraitPath)
  ]);
  entry.atlas = atlas;
  if (atlas) for (const move of definition.moves) {
    if (move.bodyAnimation && !hasAnimation(atlas, 'characters', move.bodyAnimation)) error(entry, `${atlasPath}: ${move.id} characterAnimations 조작 ID ${move.bodyAnimation} 누락`);
    if (move.effectAnimation && !hasAnimation(atlas, 'effects', move.effectAnimation)) error(entry, `${atlasPath}: ${move.id} effectAnimations 조작 ID ${move.effectAnimation} 누락`);
  }
  if (portraitExists) entry.portraitUrl = portraitPath;
  else if (definition.portraitProvided !== false) error(entry, `${portraitPath}: 이미지 로드 실패`);
  return entry;
}

export async function loadRoster(): Promise<{ entries: CharacterEntry[]; issues: string[] }> {
  const issues: string[] = [];
  let ids: string[] = [];
  try {
    const path = `${ROOT}index.json`;
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error('파일이 없거나 JSON 대신 HTML이 반환됐습니다');
    const raw: unknown = await response.json();
    if (!object(raw) || !Array.isArray(raw.characters)) throw new Error('characters 배열이 필요합니다');
    ids = raw.characters.filter((id): id is string => {
      const valid = typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
      if (!valid) issues.push(`${path}: 잘못된 캐릭터 ID ${JSON.stringify(id)}`);
      return valid;
    });
    ids = [...new Set(ids)];
    if (!ids.length) issues.push(`${path}: 등록된 캐릭터가 없습니다`);
  } catch (cause) { issues.push(`${ROOT}index.json: ${cause instanceof Error ? cause.message : String(cause)}`); }
  issues.forEach(message => console.error(message));
  const entries = await Promise.all(ids.map(loadOne));
  if (entries.some(entry => entry.data)) return { entries, issues };
  issues.push(...entries.flatMap(entry => entry.issues));
  issues.push('사용 가능한 캐릭터가 없어 내장 임시 캐릭터로 실행합니다');
  console.error(issues.at(-1));
  return { entries: [
    { id: 'fallback-player', data: playerData, atlas: null, portraitUrl: null, issues: [] },
    { id: 'fallback-dummy', data: dummyData, atlas: null, portraitUrl: null, issues: [] }
  ], issues };
}
