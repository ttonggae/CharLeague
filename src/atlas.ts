import type { Fighter } from './game.ts';
import { ANIMATION_FPS, TICK_RATE } from './data.ts';

interface AtlasPage { index: number; file: string; width: number; height: number }
interface Point { x: number; y: number }
interface AtlasFrame {
  order: number;
  durationTicks?: number;
  atlas?: string;
  atlasIndex?: number;
  rect: { x: number; y: number; width: number; height: number };
  originalSize: { width: number; height: number };
  trim: { x: number; y: number; width: number; height: number };
  pivot: Point;
  position?: Point;
  empty?: boolean;
}
interface AtlasAnimation { id?: string; name: string; skillId?: string | null; loop?: boolean; frames: AtlasFrame[] }
export interface AtlasDefinition {
  schemaVersion: 2 | 3;
  frameDurationTicks?: number;
  atlases: { characters: AtlasPage[]; effects: AtlasPage[] };
  characterAnimations: AtlasAnimation[];
  effectAnimations: AtlasAnimation[];
}
export interface LoadedAtlas {
  definition: AtlasDefinition;
  characters: Map<string, CanvasImageSource>;
  effects: Map<string, CanvasImageSource>;
}
export type AtlasIssue = (message: string) => void;

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseAtlas(raw: unknown): AtlasDefinition {
  if (!object(raw) || (raw.schemaVersion !== 2 && raw.schemaVersion !== 3)) throw new Error('schemaVersion 2 또는 3이 필요합니다');
  if (!object(raw.atlases) || !Array.isArray(raw.atlases.characters) || !Array.isArray(raw.atlases.effects)) throw new Error('atlases.characters/effects 배열이 필요합니다');
  if (!Array.isArray(raw.characterAnimations) || !Array.isArray(raw.effectAnimations)) throw new Error('characterAnimations/effectAnimations 배열이 필요합니다');
  const definition = raw as unknown as AtlasDefinition;
  for (const [kind, pages] of Object.entries(definition.atlases)) {
    for (const page of pages) {
      if (!page || typeof page.file !== 'string' || !page.file || page.file.includes('..') || page.file.startsWith('/') || !Number.isInteger(page.index)) throw new Error(`${kind} 시트의 file/index가 잘못됐습니다`);
    }
  }
  for (const [kind, animations] of [['characterAnimations', definition.characterAnimations], ['effectAnimations', definition.effectAnimations]] as const) {
    for (const animation of animations) {
      if (!animation || typeof animation.name !== 'string' || !Array.isArray(animation.frames)) throw new Error(`${kind} 항목의 name/frames가 잘못됐습니다`);
      for (const frame of animation.frames) {
        if (!frame || !Number.isFinite(frame.order) || !object(frame.rect) || !object(frame.trim) || !object(frame.pivot) || !object(frame.originalSize)
          || !Number.isFinite(frame.rect.x) || !Number.isFinite(frame.rect.y) || !Number.isFinite(frame.rect.width) || !Number.isFinite(frame.rect.height)
          || !Number.isFinite(frame.trim.x) || !Number.isFinite(frame.trim.y) || !Number.isFinite(frame.pivot.x) || !Number.isFinite(frame.pivot.y)
          || !Number.isFinite(frame.originalSize.height)) throw new Error(`${kind}/${animation.name} 프레임 좌표가 잘못됐습니다`);
      }
      animation.frames.sort((a, b) => a.order - b.order);
    }
  }
  return definition;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`이미지 로드 실패: ${url}`));
    image.src = url;
  });
}

export async function loadAtlas(path: string, issue: AtlasIssue): Promise<LoadedAtlas | null> {
  let definition: AtlasDefinition;
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error('파일이 없거나 JSON 대신 HTML이 반환됐습니다');
    definition = parseAtlas(await response.json());
  } catch (error) {
    issue(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const base = new URL(path, window.location.href);
  const characters = new Map<string, CanvasImageSource>();
  const effects = new Map<string, CanvasImageSource>();
  await Promise.all((['characters', 'effects'] as const).flatMap(kind => definition.atlases[kind].map(async page => {
    const url = new URL(page.file, base).href;
    try {
      const image = await loadImage(url);
      if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) issue(`${url}: 이미지 크기가 atlas.json과 다릅니다`);
      (kind === 'characters' ? characters : effects).set(page.file, image);
    } catch (error) { issue(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
  })));
  for (const [kind, animations] of [['characters', definition.characterAnimations], ['effects', definition.effectAnimations]] as const) {
    const pages = definition.atlases[kind];
    const loaded = kind === 'characters' ? characters : effects;
    for (const animation of animations) for (const frame of animation.frames) {
      const file = frame.atlas ?? pages.find(page => page.index === frame.atlasIndex)?.file;
      if (!frame.empty && (!file || !loaded.has(file))) issue(`${path}: ${kind}/${animation.name} 프레임의 시트 ${file ?? String(frame.atlasIndex)} 누락`);
    }
  }
  const idle = definition.characterAnimations.find(animation => animation.name === 'idle');
  if (!idle?.frames.some(frame => {
    const file = frame.atlas ?? definition.atlases.characters.find(page => page.index === frame.atlasIndex)?.file;
    return !frame.empty && !!file && characters.has(file);
  })) {
    issue(`${path}: 사용할 수 있는 idle 캐릭터 프레임이 없습니다`);
    return null;
  }
  return { definition, characters, effects };
}

function findAnimation(atlas: LoadedAtlas, kind: 'characters' | 'effects', key: string): AtlasAnimation | undefined {
  const animations = kind === 'characters' ? atlas.definition.characterAnimations : atlas.definition.effectAnimations;
  return animations.find(animation => animation.id === key || animation.name === key || animation.skillId === key);
}

export function hasAnimation(atlas: LoadedAtlas | null, kind: 'characters' | 'effects', key: string): boolean {
  return !!atlas && !!findAnimation(atlas, kind, key);
}

export function drawAtlasFrame(ctx: CanvasRenderingContext2D, atlas: LoadedAtlas | null, kind: 'characters' | 'effects', key: string, tick: number, x: number, y: number, facing: -1 | 1, scale = 1): boolean {
  if (!atlas) return false;
  const animation = findAnimation(atlas, kind, key);
  if (!animation?.frames.length) return false;
  const frames = animation.frames;
  const defaultDuration = atlas.definition.frameDurationTicks ?? TICK_RATE / ANIMATION_FPS;
  const total = frames.reduce((sum, item) => sum + (item.durationTicks ?? defaultDuration), 0);
  let elapsed = animation.loop === false ? Math.min(tick, total - 1) : tick % total;
  const frame = frames.find(item => { elapsed -= item.durationTicks ?? defaultDuration; return elapsed < 0; }) ?? frames.at(-1)!;
  if (frame.empty || frame.rect.width <= 0 || frame.rect.height <= 0) return false;
  const pages = atlas.definition.atlases[kind];
  const file = frame.atlas ?? pages.find(page => page.index === frame.atlasIndex)?.file;
  const image = file && atlas[kind].get(file);
  if (!image) return false;
  const position = frame.position ?? { x: 0, y: 0 };
  const pixelScale = Math.max(1, Math.round(scale));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(facing, 1);
  ctx.drawImage(image, frame.rect.x, frame.rect.y, frame.rect.width, frame.rect.height,
    Math.round((frame.trim.x - frame.pivot.x + position.x) * pixelScale), Math.round((frame.trim.y - frame.pivot.y + position.y) * pixelScale),
    frame.rect.width * pixelScale, frame.rect.height * pixelScale);
  ctx.restore();
  return true;
}

export function animationScale(atlas: LoadedAtlas | null, key: string, targetHeight: number): number {
  if (!atlas) return 1;
  const height = findAnimation(atlas, 'characters', key)?.frames[0]?.originalSize.height;
  return height ? Math.max(1, Math.ceil(targetHeight / height)) : 1;
}

export function animationGroundOffset(atlas: LoadedAtlas | null, key: string, scale: number, targetHeight: number): number {
  const frame = atlas && findAnimation(atlas, 'characters', key)?.frames[0];
  return frame ? Math.round((frame.originalSize.height - frame.pivot.y) * scale) : targetHeight / 2;
}

export function fighterAnimation(f: Fighter): string {
  if (f.attack) return f.attack.move.bodyAnimation ?? `attack:${f.attack.move.id}`;
  return f.state;
}
