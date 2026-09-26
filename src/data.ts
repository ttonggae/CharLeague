export const SKILL_IDS = ['A', 'S', 'D', 'Shift', 'Space'] as const;
export type Button = typeof SKILL_IDS[number];
export type Direction = 'any' | 'forward' | 'back' | 'up' | 'down';
export type FighterState = 'idle' | 'move' | 'jump' | 'fall' | 'guard' | 'attack' | 'hurt' | 'ko';

// Movement IDs are internal. Skill IDs intentionally match their physical key labels.
export const ACTION_IDS = {
  moveLeft: 'move_left', moveRight: 'move_right', jump: 'jump', drop: 'drop',
  A: 'A', S: 'S', D: 'D', Shift: 'Shift', Space: 'Space'
} as const;
export const ATTACK_IDS = SKILL_IDS;
export type ActionId = typeof ACTION_IDS[keyof typeof ACTION_IDS];

export interface MoveData {
  id: Button;
  label: string;
  sequence: Button[];
  direction: Direction;
  startup: number;
  active: number;
  recovery: number;
  cooldown?: number;
  damage: number;
  chip: number;
  knockback: { x: number; y: number };
  hitstun: number;
  reach: number;
  height: number;
  effect: string;
  color: string;
  bodyAnimation?: string;
  bodyAnimationMode?: 'overlay' | 'replace';
  effectAnimation?: string;
}

export interface CharacterData {
  id?: string;
  description?: string;
  color?: string;
  portraitProvided?: boolean;
  dummyMoveId?: Button;
  spriteScale?: number;
  name: string;
  maxHp: number;
  walkSpeed: number;
  jumpSpeed: number;
  width: number;
  height: number;
  moves: MoveData[];
}

// All timing values are 60 Hz simulation ticks. Attack animations are displayed separately at 12 FPS.
export const playerData: CharacterData = {
  name: 'PLAYER', maxHp: 100, walkSpeed: 4.1, jumpSpeed: 13.4,
  width: 42, height: 92,
  moves: [
    { id: 'A', label: '평타', sequence: ['A'], direction: 'any', startup: 5, active: 4, recovery: 10, damage: 7, chip: 1, knockback: { x: 3, y: 0 }, hitstun: 11, reach: 59, height: 48, effect: 'A', color: '#92efff' },
    { id: 'S', label: '파동 베기', sequence: ['S'], direction: 'any', startup: 12, active: 7, recovery: 19, damage: 15, chip: 2, knockback: { x: 7, y: -2 }, hitstun: 18, reach: 95, height: 64, effect: 'S', color: '#68e1ff' },
    { id: 'D', label: '충격파', sequence: ['D'], direction: 'any', startup: 18, active: 8, recovery: 24, damage: 22, chip: 4, knockback: { x: 10, y: -4 }, hitstun: 24, reach: 112, height: 76, effect: 'D', color: '#bd9bff' },
    { id: 'Shift', label: 'Shift 기술', sequence: ['Shift'], direction: 'any', startup: 10, active: 5, recovery: 18, damage: 12, chip: 1, knockback: { x: 6, y: -2 }, hitstun: 16, reach: 78, height: 60, effect: 'Shift', color: '#ddd' },
    { id: 'Space', label: 'Space 기술', sequence: ['Space'], direction: 'any', startup: 14, active: 6, recovery: 22, damage: 18, chip: 2, knockback: { x: 8, y: -4 }, hitstun: 21, reach: 96, height: 72, effect: 'Space', color: '#fff' }
  ]
};

export const dummyData: CharacterData = {
  name: 'TRAINING DUMMY', maxHp: 100, walkSpeed: 0, jumpSpeed: 0,
  width: 44, height: 96,
  moves: [{ id: 'A', label: '반격', sequence: ['A'], direction: 'any', startup: 27, active: 5, recovery: 40, damage: 12, chip: 2, knockback: { x: 6, y: -2 }, hitstun: 18, reach: 88, height: 60, effect: 'A', color: '#ff997f' }]
};

export const TICK_RATE = 60;
export const ANIMATION_FPS = 12;
export const INPUT_BUFFER = 15; // 0.25 seconds
export const COMBO_WINDOW = 48;
export const STAGE = { width: 960, height: 540, floor: 442, left: 30, right: 930 } as const;
