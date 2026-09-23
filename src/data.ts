export type Button = 'A' | 'S' | 'D';
export type Direction = 'any' | 'forward' | 'back' | 'up' | 'down';
export type FighterState = 'idle' | 'move' | 'jump' | 'fall' | 'guard' | 'attack' | 'hurt' | 'ko';

// Stable control IDs; combat move IDs are also used for Atlas Studio skillId links.
export const ACTION_IDS = {
  moveLeft: 'move_left', moveRight: 'move_right', jump: 'jump', crouch: 'crouch', guard: 'guard',
  dashLeft: 'dash_left', dashRight: 'dash_right',
  jab: 'jab', step: 'step', sweep: 'sweep', rising: 'rising', skill1: 'skill1', skill2: 'skill2', chain: 'chain', counter: 'counter',
  restart: 'restart', selectCharacter: 'select_character',
  dummyAttack: 'dummy_attack', dummyGuard: 'dummy_guard', dummyIdle: 'dummy_idle'
} as const;
export const ATTACK_IDS = [ACTION_IDS.jab, ACTION_IDS.step, ACTION_IDS.sweep, ACTION_IDS.rising, ACTION_IDS.skill1, ACTION_IDS.skill2, ACTION_IDS.chain, ACTION_IDS.counter] as const;
export type ActionId = typeof ACTION_IDS[keyof typeof ACTION_IDS];

export interface MoveData {
  id: string;
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
  dummyMoveId?: string;
  spriteScale?: number;
  name: string;
  maxHp: number;
  walkSpeed: number;
  jumpSpeed: number;
  dashSpeed: number;
  width: number;
  height: number;
  moves: MoveData[];
}

// All timing values are 60 Hz simulation ticks. Attack animations are displayed separately at 12 FPS.
export const playerData: CharacterData = {
  name: 'PLAYER', maxHp: 100, walkSpeed: 4.1, jumpSpeed: 13.4, dashSpeed: 9,
  width: 42, height: 92,
  moves: [
    { id: ACTION_IDS.chain, label: '삼연격', sequence: ['A', 'A', 'S'], direction: 'any', startup: 9, active: 7, recovery: 17, damage: 25, chip: 3, knockback: { x: 9, y: -5 }, hitstun: 25, reach: 104, height: 66, effect: ACTION_IDS.chain, color: '#ffcf6c' },
    { id: ACTION_IDS.step, label: '전진타', sequence: ['A'], direction: 'forward', startup: 6, active: 4, recovery: 10, damage: 10, chip: 1, knockback: { x: 5, y: -1 }, hitstun: 14, reach: 72, height: 56, effect: ACTION_IDS.step, color: '#92efff' },
    { id: ACTION_IDS.sweep, label: '하단 베기', sequence: ['S'], direction: 'down', startup: 11, active: 5, recovery: 17, damage: 16, chip: 2, knockback: { x: 6, y: -2 }, hitstun: 20, reach: 86, height: 32, effect: ACTION_IDS.sweep, color: '#f9a8d4' },
    { id: ACTION_IDS.rising, label: '상승타', sequence: ['D'], direction: 'up', startup: 10, active: 6, recovery: 23, damage: 20, chip: 3, knockback: { x: 5, y: -9 }, hitstun: 26, reach: 66, height: 90, effect: ACTION_IDS.rising, color: '#c4b5fd' },
    { id: ACTION_IDS.jab, label: '평타', sequence: ['A'], direction: 'any', startup: 5, active: 4, recovery: 10, damage: 7, chip: 1, knockback: { x: 3, y: 0 }, hitstun: 11, reach: 59, height: 48, effect: ACTION_IDS.jab, color: '#92efff' },
    { id: ACTION_IDS.skill1, label: '파동 베기', sequence: ['S'], direction: 'any', startup: 12, active: 7, recovery: 19, damage: 15, chip: 2, knockback: { x: 7, y: -2 }, hitstun: 18, reach: 95, height: 64, effect: ACTION_IDS.skill1, color: '#68e1ff' },
    { id: ACTION_IDS.skill2, label: '충격파', sequence: ['D'], direction: 'any', startup: 18, active: 8, recovery: 24, damage: 22, chip: 4, knockback: { x: 10, y: -4 }, hitstun: 24, reach: 112, height: 76, effect: ACTION_IDS.skill2, color: '#bd9bff' }
  ]
};

export const dummyData: CharacterData = {
  name: 'TRAINING DUMMY', maxHp: 100, walkSpeed: 0, jumpSpeed: 0, dashSpeed: 0,
  width: 44, height: 96,
  moves: [{ id: ACTION_IDS.counter, label: '반격', sequence: ['A'], direction: 'any', startup: 27, active: 5, recovery: 40, damage: 12, chip: 2, knockback: { x: 6, y: -2 }, hitstun: 18, reach: 88, height: 60, effect: ACTION_IDS.counter, color: '#ff997f' }]
};

export const TICK_RATE = 60;
export const ANIMATION_FPS = 12;
export const INPUT_BUFFER = 15; // 0.25 seconds
export const COMBO_WINDOW = 48;
export const DOUBLE_TAP_WINDOW = 14;
export const DASH_COOLDOWN = TICK_RATE; // 1 second
export const STAGE = { width: 960, height: 540, floor: 442, left: 30, right: 930 } as const;
