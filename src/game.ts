import { COMBO_WINDOW, DASH_COOLDOWN, DOUBLE_TAP_WINDOW, INPUT_BUFFER, STAGE, TICK_RATE, dummyData, playerData, type Button, type CharacterData, type FighterState, type MoveData } from './data.ts';
import type { AttackPress, InputFrame } from './input.ts';

export type DummyMode = 'attack' | 'guard' | 'idle';
export interface ActiveAttack { move: MoveData; tick: number; hit: boolean }
export interface Fighter {
  data: CharacterData;
  x: number; y: number; vx: number; vy: number; facing: -1 | 1;
  hp: number; state: FighterState; crouching: boolean; guarding: boolean;
  hurtTicks: number; dashTicks: number; attackCooldownUntilTick: number; attack: ActiveAttack | null;
}
interface BufferedPress extends AttackPress { tick: number; facing: -1 | 1 }
interface ComboPress { button: Button; tick: number }
interface ControlMemory {
  pending: BufferedPress[];
  history: ComboPress[];
  lastTap: Record<-1 | 1, number>;
  lastDashTick: number;
}
const controlMemory = (): ControlMemory => ({ pending: [], history: [], lastTap: { [-1]: -999, [1]: -999 }, lastDashTick: -999 });

export interface FighterSnapshot {
  x: number; y: number; vx: number; vy: number; facing: -1 | 1; hp: number;
  state: FighterState; crouching: boolean; guarding: boolean; hurtTicks: number;
  dashTicks: number; attackCooldownUntilTick: number;
  attack: { moveId: string; tick: number; hit: boolean } | null;
}
export interface GameSnapshot {
  tick: number; seed: number; winner: 'player' | 'dummy' | null;
  roundWins: [number, number]; koTick: number | null; seriesWinner: 'player' | 'dummy' | null;
  player: FighterSnapshot; dummy: FighterSnapshot;
  controls: [ControlMemory, ControlMemory]; dummyCooldown: number;
}

function fighter(data: CharacterData, x: number, facing: -1 | 1): Fighter {
  return { data, x, y: STAGE.floor, vx: 0, vy: 0, facing, hp: data.maxHp, state: 'idle', crouching: false, guarding: false, hurtTicks: 0, dashTicks: 0, attackCooldownUntilTick: 0, attack: null };
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

export class Game {
  player: Fighter;
  dummy: Fighter;
  tick = 0;
  mode: DummyMode = 'attack';
  winner: 'player' | 'dummy' | null = null;
  roundWins: [number, number] = [0, 0];
  koTick: number | null = null;
  seriesWinner: 'player' | 'dummy' | null = null;
  notice = 'FIGHT!';
  noticeTick = 0;
  seed: number;
  private controls: [ControlMemory, ControlMemory] = [controlMemory(), controlMemory()];
  private dummyCooldown = 150;
  private playerCharacter: CharacterData;
  private dummyCharacter: CharacterData;
  private bestOfThree: boolean;

  constructor(playerCharacter: CharacterData = playerData, dummyCharacter: CharacterData = dummyData, seed = 1, bestOfThree = false) {
    this.playerCharacter = playerCharacter;
    this.dummyCharacter = dummyCharacter;
    this.bestOfThree = bestOfThree;
    this.player = fighter(playerCharacter, 286, 1);
    this.dummy = fighter(dummyCharacter, 674, -1);
    this.seed = seed >>> 0;
  }

  restart(): void {
    this.tick = 0;
    this.roundWins = [0, 0]; this.seriesWinner = null;
    this.resetRound();
  }

  private resetRound(): void {
    this.player = fighter(this.playerCharacter, 286, 1);
    this.dummy = fighter(this.dummyCharacter, 674, -1);
    this.winner = null; this.koTick = null; this.notice = 'FIGHT!'; this.noticeTick = this.tick;
    this.controls = [controlMemory(), controlMemory()];
    this.dummyCooldown = 150;
  }

  setMode(mode: DummyMode): void {
    this.mode = mode;
    this.dummyCooldown = mode === 'attack' ? 90 : 0;
    this.dummy.guarding = false;
    this.say(mode === 'attack' ? '더미: 반격' : mode === 'guard' ? '더미: 방어' : '더미: 대기');
  }

  update(input: InputFrame): void {
    if (input.restart) this.restart();
    if (this.winner) return;
    this.beginTick();
    this.applyControlledInput(this.player, input, this.controls[0]);
    this.dummy.guarding = this.mode === 'guard' && this.canMove(this.dummy) && this.dummy.y >= STAGE.floor;
    this.updateDummyAI();
    this.finishTick();
  }

  updateOnline(playerInput: InputFrame, dummyInput: InputFrame): void {
    if (this.winner) {
      this.tick++;
      if (this.bestOfThree && !this.seriesWinner && this.koTick !== null && this.tick - this.koTick >= 3 * TICK_RATE) {
        if (this.roundWins[0] === 2 || this.roundWins[1] === 2) this.seriesWinner = this.winner;
        else this.resetRound();
      }
      return;
    }
    this.beginTick();
    this.applyControlledInput(this.player, playerInput, this.controls[0]);
    this.applyControlledInput(this.dummy, dummyInput, this.controls[1]);
    this.finishTick();
    if (this.bestOfThree && this.winner) {
      this.roundWins[this.winner === 'player' ? 0 : 1]++;
      this.koTick = this.tick;
    }
  }

  private beginTick(): void {
    this.tick++;
    for (const control of this.controls) {
      control.pending = control.pending.filter(press => this.tick - press.tick <= INPUT_BUFFER);
      control.history = control.history.filter(press => this.tick - press.tick <= COMBO_WINDOW * 2);
    }
  }

  private finishTick(): void {
    this.advanceFighter(this.player);
    this.advanceFighter(this.dummy);
    this.resolvePushboxes();
    this.resolveAttack(this.player, this.dummy);
    this.resolveAttack(this.dummy, this.player);
    this.updateState(this.player);
    this.updateState(this.dummy);
  }

  private canMove(f: Fighter): boolean { return f.hp > 0 && f.hurtTicks === 0 && !f.attack; }

  private applyControlledInput(f: Fighter, input: InputFrame, control: ControlMemory): void {
    const horizontal = Number(input.right) - Number(input.left) || input.taps.at(-1) || 0;
    if (horizontal !== 0 && !input.down && !input.guard && this.canMove(f)) f.facing = horizontal as -1 | 1;
    for (const tap of input.taps) {
      if (this.tick - control.lastTap[tap] <= DOUBLE_TAP_WINDOW && this.tick - control.lastDashTick >= DASH_COOLDOWN && this.canMove(f)) {
        f.dashTicks = 10;
        f.vx = tap * f.data.dashSpeed;
        f.facing = tap;
        control.lastDashTick = this.tick;
      }
      control.lastTap[tap] = this.tick;
    }
    for (const press of input.attacks) {
      control.pending.push({ ...press, tick: this.tick, facing: f.facing });
      control.history.push({ button: press.button, tick: this.tick });
    }
    f.crouching = input.down && f.y >= STAGE.floor && !f.attack && !f.hurtTicks;
    f.guarding = input.guard && this.canMove(f) && f.y >= STAGE.floor;
    if (this.canMove(f) && !f.guarding) {
      if (input.up && f.y >= STAGE.floor && !f.crouching) f.vy = -f.data.jumpSpeed;
      if (f.dashTicks === 0) f.vx = f.crouching ? 0 : horizontal * f.data.walkSpeed;
    } else if (!f.attack && f.hurtTicks === 0) f.vx = 0;
    this.tryBufferedAttack(f, control);
  }

  private tryBufferedAttack(f: Fighter, control: ControlMemory): void {
    if (f.hp <= 0 || f.hurtTicks > 0 || control.pending.length === 0) return;
    const press = control.pending[0];
    const move = this.chooseMove(f, control, press);
    const current = f.attack;
    const canCancel = current && !current.move.cooldown && current.move.sequence.length === 1 && current.move.sequence[0] === 'A'
      && current.tick >= current.move.startup + current.move.active
      && (press.button === 'A' || (move?.sequence.length ?? 0) > 1);
    if ((current && !canCancel) || this.tick < f.attackCooldownUntilTick) return;
    if (move) {
      this.startAttack(f, move);
      f.dashTicks = 0;
      this.say(move.label);
    }
    control.pending.shift();
  }

  private chooseMove(f: Fighter, control: ControlMemory, press: BufferedPress): MoveData | undefined {
    const recent = control.history.filter(item => item.tick <= press.tick);
    return f.data.moves.find(move => {
      if (move.sequence.at(-1) !== press.button) return false;
      if (move.direction === 'forward' && press.horizontal !== press.facing) return false;
      if (move.direction === 'back' && press.horizontal !== -press.facing) return false;
      if (move.direction === 'up' && !press.up) return false;
      if (move.direction === 'down' && !press.down) return false;
      const sequence = recent.slice(-move.sequence.length);
      return sequence.length === move.sequence.length
        && sequence.every((item, index) => item.button === move.sequence[index]
          && (index === 0 || item.tick - sequence[index - 1].tick <= COMBO_WINDOW));
    });
  }

  private startAttack(f: Fighter, move: MoveData): void {
    f.attack = { move, tick: 0, hit: false };
    f.guarding = false;
    f.vx = 0;
  }

  private updateDummyAI(): void {
    if (this.mode !== 'attack' || !this.canMove(this.dummy) || this.tick < this.dummy.attackCooldownUntilTick) return;
    if (this.dummyCooldown > 0) { this.dummyCooldown--; return; }
    if (Math.abs(this.player.x - this.dummy.x) <= 134 && Math.abs(this.player.y - this.dummy.y) < 80) {
      const move = this.dummy.data.moves.find(candidate => candidate.id === this.dummy.data.dummyMoveId) ?? this.dummy.data.moves[0];
      if (!move) return;
      this.startAttack(this.dummy, move);
      this.dummyCooldown = 115;
    }
  }

  private advanceFighter(f: Fighter): void {
    if (f.hurtTicks > 0) {
      f.hurtTicks--;
      f.vx *= 0.88;
    } else if (f.dashTicks > 0) {
      f.dashTicks--;
      if (f.dashTicks === 0) f.vx = 0;
    }
    if (f.attack) {
      f.attack.tick++;
      const { move, tick } = f.attack;
      if (tick >= move.startup + move.active + move.recovery) {
        f.attack = null;
        f.attackCooldownUntilTick = this.tick + (move.cooldown ?? 0);
      }
    }
    f.x = clamp(f.x + f.vx, STAGE.left + f.data.width / 2, STAGE.right - f.data.width / 2);
    if (f.y < STAGE.floor || f.vy < 0) {
      f.vy += 0.65;
      f.y += f.vy;
      if (f.y >= STAGE.floor) { f.y = STAGE.floor; f.vy = 0; }
    }
  }

  private resolvePushboxes(): void {
    const a = this.player, b = this.dummy;
    if (Math.abs(a.y - b.y) > 75) return;
    const minDistance = (a.data.width + b.data.width) / 2;
    const distance = Math.abs(a.x - b.x);
    if (distance >= minDistance) return;
    const direction = a.x <= b.x ? -1 : 1;
    const correction = (minDistance - distance) / 2;
    a.x = clamp(a.x + direction * correction, STAGE.left + a.data.width / 2, STAGE.right - a.data.width / 2);
    b.x = clamp(b.x - direction * correction, STAGE.left + b.data.width / 2, STAGE.right - b.data.width / 2);
  }

  private resolveAttack(attacker: Fighter, defender: Fighter): void {
    const attack = attacker.attack;
    if (!attack || attack.hit || defender.hp <= 0) return;
    const move = attack.move;
    if (attack.tick < move.startup || attack.tick >= move.startup + move.active) return;
    const forwardDistance = (defender.x - attacker.x) * attacker.facing;
    const verticalDistance = Math.abs((attacker.y - move.height / 2) - (defender.y - defender.data.height / 2));
    if (forwardDistance < 0 || forwardDistance > move.reach + defender.data.width / 2 || verticalDistance > (move.height + defender.data.height) / 2) return;
    attack.hit = true;
    const blocked = defender.guarding && defender.facing === -attacker.facing && defender.y >= STAGE.floor;
    defender.hp = Math.max(0, defender.hp - (blocked ? move.chip : move.damage));
    defender.vx = attacker.facing * move.knockback.x * (blocked ? 0.28 : 1);
    if (!blocked) {
      defender.vy = move.knockback.y;
      defender.attack = null;
      defender.dashTicks = 0;
      defender.hurtTicks = move.hitstun;
      defender.guarding = false;
    }
    this.say(blocked ? 'BLOCK' : `${move.label} · ${move.damage}`);
    if (defender.hp === 0) {
      this.winner = defender === this.dummy ? 'player' : 'dummy';
      defender.attack = null;
      defender.hurtTicks = 0;
      defender.vx = 0;
      defender.vy = 0;
      defender.state = 'ko';
      this.say(this.winner === 'player' ? 'PLAYER WINS' : 'DUMMY WINS');
    }
  }

  private updateState(f: Fighter): void {
    if (f.hp <= 0) f.state = 'ko';
    else if (f.hurtTicks > 0) f.state = 'hurt';
    else if (f.attack) f.state = 'attack';
    else if (f.y < STAGE.floor) f.state = f.vy < 0 ? 'jump' : 'fall';
    else if (f.guarding) f.state = 'guard';
    else if (Math.abs(f.vx) > 0.1) f.state = 'move';
    else f.state = 'idle';
  }

  snapshot(): GameSnapshot {
    const save = (f: Fighter): FighterSnapshot => ({
      x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: f.facing, hp: f.hp,
      state: f.state, crouching: f.crouching, guarding: f.guarding,
      hurtTicks: f.hurtTicks, dashTicks: f.dashTicks,
      attackCooldownUntilTick: f.attackCooldownUntilTick,
      attack: f.attack ? { moveId: f.attack.move.id, tick: f.attack.tick, hit: f.attack.hit } : null
    });
    return {
      tick: this.tick, seed: this.seed, winner: this.winner,
      roundWins: [...this.roundWins], koTick: this.koTick, seriesWinner: this.seriesWinner,
      player: save(this.player), dummy: save(this.dummy),
      controls: structuredClone(this.controls), dummyCooldown: this.dummyCooldown
    };
  }

  restore(snapshot: GameSnapshot): void {
    const restoreFighter = (data: CharacterData, saved: FighterSnapshot): Fighter => {
      const move = saved.attack && data.moves.find(candidate => candidate.id === saved.attack!.moveId);
      if (saved.attack && !move) throw new Error(`알 수 없는 기술 ID: ${saved.attack.moveId}`);
      return { data, x: saved.x, y: saved.y, vx: saved.vx, vy: saved.vy,
        facing: saved.facing, hp: saved.hp, state: saved.state,
        crouching: saved.crouching, guarding: saved.guarding,
        hurtTicks: saved.hurtTicks, dashTicks: saved.dashTicks,
        attackCooldownUntilTick: saved.attackCooldownUntilTick,
        attack: saved.attack && move ? { move, tick: saved.attack.tick, hit: saved.attack.hit } : null };
    };
    const player = restoreFighter(this.playerCharacter, snapshot.player);
    const dummy = restoreFighter(this.dummyCharacter, snapshot.dummy);
    this.player = player; this.dummy = dummy;
    this.controls = structuredClone(snapshot.controls);
    this.dummyCooldown = snapshot.dummyCooldown;
    this.tick = snapshot.tick; this.seed = snapshot.seed >>> 0; this.winner = snapshot.winner;
    this.roundWins = [...snapshot.roundWins]; this.koTick = snapshot.koTick; this.seriesWinner = snapshot.seriesWinner;
    this.notice = '동기화 복구'; this.noticeTick = this.tick;
  }

  private say(message: string): void { this.notice = message; this.noticeTick = this.tick; }
}

export const emptyInput = (): InputFrame => ({ left: false, right: false, up: false, down: false, guard: false, taps: [], attacks: [], restart: false });
