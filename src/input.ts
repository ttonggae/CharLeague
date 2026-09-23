import { ACTION_IDS, type ActionId, type Button } from './data.ts';

export interface AttackPress { button: Button; horizontal: -1 | 0 | 1; up: boolean; down: boolean }
export interface InputFrame {
  left: boolean; right: boolean; up: boolean; down: boolean; guard: boolean;
  taps: Array<-1 | 1>; attacks: AttackPress[]; restart: boolean;
}

const keysToStop = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'KeyA', 'KeyS', 'KeyD', 'KeyR']);
export const KEY_ACTION_IDS: Record<string, ActionId> = {
  ArrowLeft: ACTION_IDS.moveLeft, ArrowRight: ACTION_IDS.moveRight,
  ArrowUp: ACTION_IDS.jump, ArrowDown: ACTION_IDS.crouch,
  ShiftLeft: ACTION_IDS.guard, ShiftRight: ACTION_IDS.guard,
  KeyA: ACTION_IDS.jab, KeyS: ACTION_IDS.skill1, KeyD: ACTION_IDS.skill2,
  KeyR: ACTION_IDS.restart, KeyC: ACTION_IDS.selectCharacter,
  Digit1: ACTION_IDS.dummyAttack, Digit2: ACTION_IDS.dummyGuard, Digit3: ACTION_IDS.dummyIdle
};

export class KeyboardInput {
  private target: Window;
  private held = new Set<string>();
  private taps: Array<-1 | 1> = [];
  private attacks: AttackPress[] = [];
  private restart = false;

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private onDown = (event: KeyboardEvent) => {
    if (keysToStop.has(event.code)) event.preventDefault();
    if (event.repeat || this.held.has(event.code)) return;
    this.held.add(event.code);
    const action = KEY_ACTION_IDS[event.code];
    if (action === ACTION_IDS.moveLeft) this.taps.push(-1);
    if (action === ACTION_IDS.moveRight) this.taps.push(1);
    if (action === ACTION_IDS.restart) this.restart = true;
    const button: Button | null = action === ACTION_IDS.jab ? 'A' : action === ACTION_IDS.skill1 ? 'S' : action === ACTION_IDS.skill2 ? 'D' : null;
    if (button) this.attacks.push({ button, horizontal: this.hasAction(ACTION_IDS.moveRight) ? 1 : this.hasAction(ACTION_IDS.moveLeft) ? -1 : 0, up: this.hasAction(ACTION_IDS.jump), down: this.hasAction(ACTION_IDS.crouch) });
  };
  private onUp = (event: KeyboardEvent) => { this.held.delete(event.code); };
  private onBlur = () => { this.held.clear(); this.taps = []; this.attacks = []; };
  private hasAction(action: ActionId): boolean {
    for (const code of this.held) if (KEY_ACTION_IDS[code] === action) return true;
    return false;
  }

  read(): InputFrame {
    const frame: InputFrame = {
      left: this.hasAction(ACTION_IDS.moveLeft), right: this.hasAction(ACTION_IDS.moveRight),
      up: this.hasAction(ACTION_IDS.jump), down: this.hasAction(ACTION_IDS.crouch),
      guard: this.hasAction(ACTION_IDS.guard),
      taps: this.taps.splice(0), attacks: this.attacks.splice(0), restart: this.restart
    };
    this.restart = false;
    return frame;
  }

  destroy() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
