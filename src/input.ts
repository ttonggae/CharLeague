import { ACTION_IDS, type ActionId, type Button } from './data.ts';

export interface AttackPress { button: Button; horizontal: -1 | 0 | 1; up: boolean; down: boolean }
export interface InputFrame {
  left: boolean; right: boolean; up: boolean; down: boolean;
  attacks: AttackPress[];
}

const keysToStop = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyA', 'KeyS', 'KeyD']);
export const KEY_ACTION_IDS: Readonly<Record<string, ActionId>> = {
  ArrowLeft: ACTION_IDS.moveLeft, ArrowRight: ACTION_IDS.moveRight,
  ArrowUp: ACTION_IDS.jump, ArrowDown: ACTION_IDS.drop,
  KeyA: ACTION_IDS.A, KeyS: ACTION_IDS.S, KeyD: ACTION_IDS.D,
  ShiftLeft: ACTION_IDS.Shift, ShiftRight: ACTION_IDS.Shift, Space: ACTION_IDS.Space
};

const isSkill = (action: ActionId | undefined): action is Button => action === 'A' || action === 'S' || action === 'D' || action === 'Shift' || action === 'Space';

export class KeyboardInput {
  private target: Window;
  private held = new Set<string>();
  private attacks: AttackPress[] = [];

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
    if (isSkill(action)) this.attacks.push({
      button: action,
      horizontal: this.hasAction(ACTION_IDS.moveRight) ? 1 : this.hasAction(ACTION_IDS.moveLeft) ? -1 : 0,
      up: this.hasAction(ACTION_IDS.jump),
      down: this.hasAction(ACTION_IDS.drop)
    });
  };
  private onUp = (event: KeyboardEvent) => { this.held.delete(event.code); };
  private onBlur = () => { this.held.clear(); this.attacks = []; };
  private hasAction(action: ActionId): boolean {
    for (const code of this.held) if (KEY_ACTION_IDS[code] === action) return true;
    return false;
  }

  read(): InputFrame {
    return {
      left: this.hasAction(ACTION_IDS.moveLeft), right: this.hasAction(ACTION_IDS.moveRight),
      up: this.hasAction(ACTION_IDS.jump), down: this.hasAction(ACTION_IDS.drop),
      attacks: this.attacks.splice(0)
    };
  }

  destroy() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
