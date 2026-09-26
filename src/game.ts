import { COMBO_WINDOW, INPUT_BUFFER, STAGE, TICK_RATE, dummyData, playerData, type Button, type CharacterData, type FighterState, type MoveData } from './data.ts';
import type { AttackPress, InputFrame } from './input.ts';
import { advanceUltimate, applyPassive, canUseMove, isUltimateMove, isUltimateReady, passiveDamageMultiplier, spendForMove } from './abilities.ts';

export type DummyMode = 'attack' | 'guard' | 'idle';
export interface ActiveAttack { move: MoveData; tick: number; hit: boolean }
export interface Fighter {
  data: CharacterData;
  x: number; y: number; vx: number; vy: number; facing: -1 | 1;
  hp: number; stamina: number; ultimateProgress: number; state: FighterState; guarding: boolean; guardHeld: boolean;
  hurtTicks: number; stunTicks: number; ultimateReadyEffectTick: number | null;
  cooldowns: Record<Button, number>; attack: ActiveAttack | null;
}
export interface GameProjectile { owner: 0 | 1; moveId: Button; x: number; y: number; vx: number; age: number }
interface BufferedPress extends AttackPress { tick: number; facing: -1 | 1 }
interface ComboPress { button: Button; tick: number }
interface ControlMemory {
  pending: BufferedPress[];
  history: ComboPress[];
}
const controlMemory = (): ControlMemory => ({ pending: [], history: [] });

export interface FighterSnapshot {
  x: number; y: number; vx: number; vy: number; facing: -1 | 1; hp: number; stamina: number; ultimateProgress: number;
  state: FighterState; guarding: boolean; guardHeld: boolean; hurtTicks: number;
  stunTicks: number; ultimateReadyEffectTick: number | null;
  cooldowns: Record<Button, number>;
  attack: { moveId: string; tick: number; hit: boolean } | null;
}
export interface GameSnapshot {
  tick: number; seed: number; winner: 'player' | 'dummy' | null;
  roundWins: [number, number]; koTick: number | null; seriesWinner: 'player' | 'dummy' | null;
  player: FighterSnapshot; dummy: FighterSnapshot;
  controls: [ControlMemory, ControlMemory]; dummyCooldown: number; projectiles: GameProjectile[];
}

function fighter(data: CharacterData, x: number, facing: -1 | 1): Fighter {
  return { data, x, y: STAGE.floor, vx: 0, vy: 0, facing, hp: data.maxHp, stamina: data.maxStamina, ultimateProgress: 0, state: 'idle', guarding: false, guardHeld: false, hurtTicks: 0, stunTicks: 0, ultimateReadyEffectTick: null,
    cooldowns: { A: 0, S: 0, D: 0, Shift: 0, Space: 0 }, attack: null };
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
  projectiles: GameProjectile[] = [];
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
    this.projectiles = [];
  }

  setMode(mode: DummyMode): void {
    this.mode = mode;
    this.dummyCooldown = mode === 'attack' ? 90 : 0;
    this.dummy.guarding = false; this.dummy.guardHeld = false;
    this.say(mode === 'attack' ? '더미: 반격' : mode === 'guard' ? '더미: 방어' : '더미: 대기');
  }

  update(input: InputFrame): void {
    if (this.winner) return;
    this.beginTick();
    this.applyControlledInput(this.player, input, this.controls[0]);
    this.dummy.guardHeld = this.mode === 'guard';
    this.dummy.guarding = this.dummy.guardHeld && this.canMove(this.dummy) && this.dummy.y >= STAGE.floor;
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
    this.advanceFighter(this.player, 0);
    this.advanceFighter(this.dummy, 1);
    this.resolvePushboxes();
    this.resolveAttack(this.player, this.dummy);
    this.resolveAttack(this.dummy, this.player);
    this.advanceProjectiles();
    this.updateState(this.player);
    this.updateState(this.dummy);
  }

  private canMove(f: Fighter): boolean { return f.hp > 0 && f.hurtTicks === 0 && f.stunTicks === 0 && !f.attack; }

  private applyControlledInput(f: Fighter, input: InputFrame, control: ControlMemory): void {
    const horizontal = Number(input.right) - Number(input.left);
    if (horizontal !== 0 && this.canMove(f)) f.facing = horizontal as -1 | 1;
    for (const press of input.attacks) {
      if (f.data.moves.some(move => move.id === press.button && move.kind === 'guard')) continue;
      control.pending.push({ ...press, tick: this.tick, facing: f.facing });
      control.history.push({ button: press.button, tick: this.tick });
    }
    const guardMove = f.data.moves.find(move => move.id === 'Shift' && move.kind === 'guard');
    f.guardHeld = !!guardMove && input.heldSkills.includes('Shift');
    f.guarding = f.guardHeld && this.canMove(f) && f.y >= STAGE.floor && f.stamina > 0;
    if (f.guarding && guardMove) {
      f.stamina = Math.max(0, Math.round((f.stamina - (guardMove.guardStaminaPerSecond ?? 0) / TICK_RATE) * 1000) / 1000);
      if (f.stamina === 0) f.guarding = false;
    }
    if (this.canMove(f) && !f.guarding) {
      if (input.up && f.y >= STAGE.floor) f.vy = -f.data.jumpSpeed;
      f.vx = horizontal * f.data.walkSpeed;
    } else if (!f.attack && f.hurtTicks === 0) f.vx = 0;
    this.tryBufferedAttack(f, control);
  }

  private tryBufferedAttack(f: Fighter, control: ControlMemory): void {
    if (f.hp <= 0 || f.hurtTicks > 0 || f.stunTicks > 0 || control.pending.length === 0) return;
    for (let index = 0; index < control.pending.length; index++) {
      const press = control.pending[index];
      const move = this.chooseMove(f, control, press);
      if (!move) { control.pending.splice(index--, 1); continue; }
      if (!canUseMove(f, move)) continue;
      const current = f.attack;
      const canCancel = current && !current.move.cooldown && current.move.sequence.length === 1 && current.move.sequence[0] === 'A'
        && current.tick >= current.move.startup + current.move.active
        && (press.button === 'A' || move.sequence.length > 1);
      if ((current && !canCancel) || this.tick < f.cooldowns[move.id]) return;
      if (this.startAttack(f, move)) {
        control.pending.splice(index, 1);
      }
      return;
    }
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

  private startAttack(f: Fighter, move: MoveData): boolean {
    if (move.kind === 'guard' || !canUseMove(f, move)) return false;
    spendForMove(f, move);
    if (isUltimateMove(f, move)) f.ultimateReadyEffectTick = null;
    f.attack = { move, tick: 0, hit: false };
    f.guarding = false;
    f.vx = 0;
    return true;
  }

  private updateDummyAI(): void {
    if (this.mode !== 'attack' || !this.canMove(this.dummy)) return;
    if (this.dummyCooldown > 0) { this.dummyCooldown--; return; }
    if (Math.abs(this.player.x - this.dummy.x) <= 134 && Math.abs(this.player.y - this.dummy.y) < 80) {
      const move = this.dummy.data.moves.find(candidate => candidate.id === this.dummy.data.dummyMoveId) ?? this.dummy.data.moves[0];
      if (!move) return;
      if (this.tick < this.dummy.cooldowns[move.id]) { this.dummyCooldown = 1; return; }
      if (this.startAttack(this.dummy, move)) this.dummyCooldown = 115;
      else this.dummyCooldown = 15;
    }
  }

  private advanceFighter(f: Fighter, owner: 0 | 1): void {
    if (f.hp > 0 && !f.guardHeld && f.stamina < f.data.maxStamina) f.stamina = Math.min(f.data.maxStamina, Math.round((f.stamina + f.data.staminaRegen) * 1000) / 1000);
    if (f.hurtTicks > 0) {
      f.hurtTicks--;
      f.vx *= 0.88;
    }
    if (f.stunTicks > 0) { f.stunTicks--; f.vx *= 0.88; }
    if (f.ultimateReadyEffectTick !== null) {
      if (!isUltimateReady(f)) f.ultimateReadyEffectTick = null;
      else if (++f.ultimateReadyEffectTick >= (f.data.ultimate?.readyEffectTicks ?? 40)) f.ultimateReadyEffectTick = null;
    }
    if (f.attack) {
      f.attack.tick++;
      const { move, tick } = f.attack;
      if (move.kind === 'projectile' && move.projectile && tick === move.startup) this.spawnProjectile(f, owner, move);
      if (tick >= move.startup + move.active + move.recovery) {
        f.attack = null;
        f.cooldowns[move.id] = this.tick + (move.cooldown ?? 0);
      }
    }
    f.x = clamp(f.x + f.vx, STAGE.left + f.data.width / 2, STAGE.right - f.data.width / 2);
    if (f.y < STAGE.floor || f.vy < 0) {
      f.vy += 0.65;
      f.y += f.vy;
      if (f.y >= STAGE.floor) { f.y = STAGE.floor; f.vy = 0; }
    }
  }

  private spawnProjectile(f: Fighter, owner: 0 | 1, move: MoveData): void {
    const projectile = move.projectile;
    if (!projectile) return;
    this.projectiles.push({ owner, moveId: move.id,
      x: f.x + f.facing * (f.data.width / 2 + projectile.width / 2), y: f.y - projectile.height / 2,
      vx: f.facing * projectile.speed, age: 0 });
  }

  private advanceProjectiles(): void {
    const remaining: GameProjectile[] = [];
    for (const projectile of this.projectiles) {
      const attacker = projectile.owner === 0 ? this.player : this.dummy;
      const defender = projectile.owner === 0 ? this.dummy : this.player;
      const move = attacker.data.moves.find(candidate => candidate.id === projectile.moveId);
      if (!move?.projectile || defender.hp <= 0) continue;
      projectile.x += projectile.vx; projectile.age++;
      const hit = Math.abs(projectile.x - defender.x) <= move.projectile.width / 2 + defender.data.width / 2
        && Math.abs(projectile.y - (defender.y - defender.data.height / 2)) <= move.projectile.height / 2 + defender.data.height / 2;
      if (hit) { this.applyHit(attacker, defender, move); continue; }
      if (projectile.age < move.projectile.lifetime && projectile.x > STAGE.left - move.projectile.width && projectile.x < STAGE.right + move.projectile.width) remaining.push(projectile);
    }
    this.projectiles = remaining;
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
    if (move.kind === 'projectile' || move.kind === 'guard') return;
    if (attack.tick < move.startup || attack.tick >= move.startup + move.active) return;
    const forwardDistance = (defender.x - attacker.x) * attacker.facing;
    const horizontalHit = move.kind === 'area'
      ? Math.abs(defender.x - attacker.x) <= move.reach + defender.data.width / 2
      : forwardDistance >= 0 && forwardDistance <= move.reach + defender.data.width / 2;
    const verticalHit = attacker.y - move.height <= defender.y && attacker.y >= defender.y - defender.data.height;
    if (!horizontalHit || !verticalHit) return;
    attack.hit = true;
    this.applyHit(attacker, defender, move);
  }

  private applyHit(attacker: Fighter, defender: Fighter, move: MoveData): void {
    const guarded = defender.guarding;
    const guardMove = guarded ? defender.data.moves.find(candidate => candidate.kind === 'guard') : undefined;
    const criticalMultiplier = passiveDamageMultiplier(attacker, defender.stunTicks > 0 ? 'stun' : null);
    const fullDamage = Math.round(move.damage * criticalMultiplier);
    const damage = guarded ? guardMove ? Math.ceil(fullDamage * (1 - (guardMove.damageReduction ?? 0))) : move.chip : fullDamage;
    defender.hp = Math.max(0, defender.hp - damage);
    defender.vx = attacker.facing * move.knockback.x * (guarded ? 0.28 : 1);
    if (!guarded) {
      defender.vy = move.knockback.y;
      defender.attack = null;
      if (move.stunTicks) { defender.stunTicks = Math.max(defender.stunTicks, move.stunTicks); defender.hurtTicks = 0; }
      else defender.hurtTicks = move.hitstun;
      defender.guarding = false;
    }
    const wasUltimateReady = isUltimateReady(attacker);
    applyPassive(defender, { type: 'takeDamage', move, value: damage });
    advanceUltimate(defender, { type: 'takeDamage', move, value: damage });
    applyPassive(attacker, { type: 'landHit', move, value: damage });
    advanceUltimate(attacker, { type: 'landHit', move, value: damage });
    if (!wasUltimateReady && isUltimateReady(attacker)) attacker.ultimateReadyEffectTick = 0;
    this.say(guarded ? `GUARD · ${damage}` : criticalMultiplier > 1 ? `CRITICAL · ${damage}` : `HIT · ${damage}`);
    if (defender.hp === 0) {
      this.winner = defender === this.dummy ? 'player' : 'dummy';
      defender.attack = null;
      defender.hurtTicks = 0;
      defender.stunTicks = 0;
      defender.vx = 0;
      defender.vy = 0;
      defender.state = 'ko';
      this.say(this.winner === 'player' ? 'PLAYER WINS' : 'DUMMY WINS');
    }
  }

  private updateState(f: Fighter): void {
    if (f.hp <= 0) f.state = 'ko';
    else if (f.stunTicks > 0) f.state = 'stun';
    else if (f.hurtTicks > 0) f.state = 'hurt';
    else if (f.attack) f.state = 'attack';
    else if (f.y < STAGE.floor) f.state = f.vy < 0 ? 'jump' : 'fall';
    else if (f.guarding) f.state = 'guard';
    else if (Math.abs(f.vx) > 0.1) f.state = 'move';
    else f.state = 'idle';
  }

  snapshot(): GameSnapshot {
    const save = (f: Fighter): FighterSnapshot => ({
      x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: f.facing, hp: f.hp, stamina: f.stamina, ultimateProgress: f.ultimateProgress,
      state: f.state, guarding: f.guarding, guardHeld: f.guardHeld,
      hurtTicks: f.hurtTicks, stunTicks: f.stunTicks, ultimateReadyEffectTick: f.ultimateReadyEffectTick,
      cooldowns: { ...f.cooldowns },
      attack: f.attack ? { moveId: f.attack.move.id, tick: f.attack.tick, hit: f.attack.hit } : null
    });
    return {
      tick: this.tick, seed: this.seed, winner: this.winner,
      roundWins: [...this.roundWins], koTick: this.koTick, seriesWinner: this.seriesWinner,
      player: save(this.player), dummy: save(this.dummy),
      controls: structuredClone(this.controls), dummyCooldown: this.dummyCooldown, projectiles: structuredClone(this.projectiles)
    };
  }

  restore(snapshot: GameSnapshot): void {
    const restoreFighter = (data: CharacterData, saved: FighterSnapshot): Fighter => {
      const move = saved.attack && data.moves.find(candidate => candidate.id === saved.attack!.moveId);
      if (saved.attack && !move) throw new Error(`알 수 없는 기술 ID: ${saved.attack.moveId}`);
      return { data, x: saved.x, y: saved.y, vx: saved.vx, vy: saved.vy,
        facing: saved.facing, hp: saved.hp, stamina: saved.stamina, ultimateProgress: saved.ultimateProgress, state: saved.state,
        guarding: saved.guarding, guardHeld: saved.guardHeld,
        hurtTicks: saved.hurtTicks, stunTicks: saved.stunTicks, ultimateReadyEffectTick: saved.ultimateReadyEffectTick,
        cooldowns: { ...saved.cooldowns },
        attack: saved.attack && move ? { move, tick: saved.attack.tick, hit: saved.attack.hit } : null };
    };
    const player = restoreFighter(this.playerCharacter, snapshot.player);
    const dummy = restoreFighter(this.dummyCharacter, snapshot.dummy);
    this.player = player; this.dummy = dummy;
    this.controls = structuredClone(snapshot.controls);
    this.dummyCooldown = snapshot.dummyCooldown;
    this.projectiles = structuredClone(snapshot.projectiles);
    this.tick = snapshot.tick; this.seed = snapshot.seed >>> 0; this.winner = snapshot.winner;
    this.roundWins = [...snapshot.roundWins]; this.koTick = snapshot.koTick; this.seriesWinner = snapshot.seriesWinner;
    this.notice = '동기화 복구'; this.noticeTick = this.tick;
  }

  private say(message: string): void { this.notice = message; this.noticeTick = this.tick; }
}

export const emptyInput = (): InputFrame => ({ left: false, right: false, up: false, down: false, attacks: [], heldSkills: [] });
