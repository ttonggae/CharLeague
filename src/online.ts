import { SKILL_IDS, TICK_RATE, type FighterState } from './data.ts';
import type { InputFrame, AttackPress } from './input.ts';
import { Game, emptyInput, type GameSnapshot } from './game.ts';
import type { CharacterEntry } from './characters.ts';

export const ONLINE_VERSION = 'grim-war-online-6';
export const INPUT_DELAY = 3;
const MAX_FRAME = 1_000_000_000;
const INPUT_MASK = 2 ** 34 - 1;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

export function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function rosterVersion(entries: CharacterEntry[]): string {
  return `${ONLINE_VERSION}-${hashText(JSON.stringify(entries.filter(entry => entry.data).map(entry => ({
    id: entry.id, data: entry.data, atlas: entry.atlas?.definition ?? null
  })).sort((a, b) => a.id.localeCompare(b.id))))}`;
}

export function createInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function tokenFromFragment(fragment: string): string | null {
  const match = /^#duel=([a-f0-9]{48})$/.exec(fragment);
  return match?.[1] ?? null;
}

export function inviteUrl(token: string): string {
  const url = new URL(location.href);
  url.hash = `duel=${token}`;
  return url.href;
}

const attackButtons = SKILL_IDS;
function pressCode(press: AttackPress): number {
  return (press.horizontal === -1 ? 1 : press.horizontal === 1 ? 2 : 0) | (press.up ? 4 : 0) | (press.down ? 8 : 0);
}

export function packInput(input: InputFrame): number {
  let bits = Number(input.left) | (Number(input.right) << 1) | (Number(input.up) << 2)
    | (Number(input.down) << 3);
  for (let i = 0; i < attackButtons.length; i++) {
    const press = input.attacks.find(item => item.button === attackButtons[i]);
    if (press) bits |= (1 << (4 + i)) | (pressCode(press) << (9 + i * 4));
  }
  for (let i = 0; i < attackButtons.length; i++) if (input.heldSkills.includes(attackButtons[i])) bits += 2 ** (29 + i);
  return bits;
}

export function validInputBits(bits: unknown): bits is number {
  if (!integer(bits, 0, INPUT_MASK)) return false;
  for (let i = 0; i < attackButtons.length; i++) {
    const code = (bits >>> (9 + i * 4)) & 15;
    if (code % 4 === 3 || (!(bits & (1 << (4 + i))) && code !== 0)) return false;
  }
  return true;
}

export function unpackInput(bits: number): InputFrame {
  if (!validInputBits(bits)) throw new Error('잘못된 입력 비트');
  const frame = emptyInput();
  frame.left = !!(bits & 1); frame.right = !!(bits & 2);
  frame.up = !!(bits & 4); frame.down = !!(bits & 8);
  for (let i = 0; i < attackButtons.length; i++) if (bits & (1 << (4 + i))) {
    const code = (bits >>> (9 + i * 4)) & 15;
    frame.attacks.push({ button: attackButtons[i], horizontal: code % 4 === 1 ? -1 : code % 4 === 2 ? 1 : 0,
      up: !!(code & 4), down: !!(code & 8) });
  }
  frame.heldSkills = attackButtons.filter((_, index) => Math.floor(bits / 2 ** (29 + index)) % 2 === 1);
  return frame;
}

export interface InputPacket { kind: 'input'; frame: number; bits: number }
export interface HashPacket { kind: 'hash'; frame: number; hash: string }
export interface SnapshotPacket { kind: 'snapshot'; frame: number; state: GameSnapshot }
export function parseInputPacket(raw: unknown): InputPacket | null {
  return object(raw) && raw.kind === 'input' && integer(raw.frame, 1, MAX_FRAME) && validInputBits(raw.bits)
    ? raw as unknown as InputPacket : null;
}
export function parseHashPacket(raw: unknown): HashPacket | null {
  return object(raw) && raw.kind === 'hash' && integer(raw.frame, 1, MAX_FRAME)
    && typeof raw.hash === 'string' && /^[a-f0-9]{8}$/.test(raw.hash) ? raw as unknown as HashPacket : null;
}

const states = new Set<FighterState>(['idle', 'move', 'jump', 'fall', 'guard', 'attack', 'hurt', 'stun', 'ko']);
function validFighter(raw: unknown, gameFighter: Game['player']): boolean {
  if (!object(raw)) return false;
  for (const key of ['x', 'y', 'vx', 'vy']) if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || Math.abs(raw[key]) > 10_000) return false;
  const ultimateTarget = gameFighter.data.ultimate?.condition.target ?? 0;
  const cooldowns = raw.cooldowns;
  if (!integer(raw.hp, 0, gameFighter.data.maxHp)
    || typeof raw.stamina !== 'number' || !Number.isFinite(raw.stamina) || raw.stamina < 0 || raw.stamina > gameFighter.data.maxStamina
    || typeof raw.ultimateProgress !== 'number' || !Number.isFinite(raw.ultimateProgress) || raw.ultimateProgress < 0 || raw.ultimateProgress > ultimateTarget
    || (raw.facing !== -1 && raw.facing !== 1)
    || !states.has(raw.state as FighterState) || typeof raw.guarding !== 'boolean' || typeof raw.guardHeld !== 'boolean'
    || !integer(raw.hurtTicks, 0, 10_000)
    || !integer(raw.stunTicks, 0, 10_000)
    || (raw.ultimateReadyEffectTick !== null && !integer(raw.ultimateReadyEffectTick, 0, 10_000))
    || !object(cooldowns)
    || !SKILL_IDS.every(id => integer(cooldowns[id], 0, MAX_FRAME))) return false;
  if (raw.attack === null) return true;
  if (!object(raw.attack) || typeof raw.attack.moveId !== 'string') return false;
  const attack = raw.attack;
  return gameFighter.data.moves.some(move => move.id === attack.moveId)
    && integer(attack.tick, 0, 10_000) && typeof attack.hit === 'boolean';
}
function validProjectiles(raw: unknown, game: Game): boolean {
  if (!Array.isArray(raw) || raw.length > 32) return false;
  return raw.every(projectile => {
    if (!object(projectile) || (projectile.owner !== 0 && projectile.owner !== 1)
      || !SKILL_IDS.includes(projectile.moveId as typeof SKILL_IDS[number])
      || !integer(projectile.age, 0, 10_000)) return false;
    for (const key of ['x', 'y', 'vx']) if (typeof projectile[key] !== 'number' || !Number.isFinite(projectile[key]) || Math.abs(projectile[key]) > 10_000) return false;
    const fighter = projectile.owner === 0 ? game.player : game.dummy;
    return fighter.data.moves.some(move => move.id === projectile.moveId && move.kind === 'projectile');
  });
}
function validControls(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length !== 2) return false;
  return raw.every(control => object(control) && Array.isArray(control.pending) && control.pending.length <= 64
    && control.pending.every((press: unknown) => object(press) && SKILL_IDS.includes(press.button as typeof SKILL_IDS[number])
      && integer(press.tick, 0, MAX_FRAME) && (press.facing === -1 || press.facing === 1)
      && [0, -1, 1].includes(press.horizontal as number) && typeof press.up === 'boolean' && typeof press.down === 'boolean')
    && Array.isArray(control.history) && control.history.length <= 128
    && control.history.every((press: unknown) => object(press) && SKILL_IDS.includes(press.button as typeof SKILL_IDS[number]) && integer(press.tick, 0, MAX_FRAME)));
}
export function parseSnapshotPacket(raw: unknown, game: Game): SnapshotPacket | null {
  if (!object(raw) || raw.kind !== 'snapshot' || !integer(raw.frame, 0, MAX_FRAME) || !object(raw.state)) return null;
  const state = raw.state;
  if (state.tick !== raw.frame || !integer(state.seed, 0, 0xffffffff)
    || ![null, 'player', 'dummy'].includes(state.winner as null | string)
    || !Array.isArray(state.roundWins) || state.roundWins.length !== 2
    || !state.roundWins.every((wins: unknown) => integer(wins, 0, 2))
    || state.roundWins[0] + state.roundWins[1] > 3
    || (state.koTick !== null && !integer(state.koTick, 0, raw.frame as number))
    || ![null, 'player', 'dummy'].includes(state.seriesWinner as null | string)
    || (state.seriesWinner !== null && (state.seriesWinner !== state.winner
      || state.roundWins[state.seriesWinner === 'player' ? 0 : 1] !== 2))
    || !integer(state.dummyCooldown, 0, 10_000) || !validControls(state.controls) || !validProjectiles(state.projectiles, game)
    || !validFighter(state.player, game.player)
    || !validFighter(state.dummy, game.dummy)) return null;
  return raw as unknown as SnapshotPacket;
}

export interface MatchTransport {
  sendInput(packet: InputPacket): void;
  sendHash(packet: HashPacket): void;
  sendSnapshot(packet: SnapshotPacket): void;
}

export class OnlineMatch {
  game: Game;
  side: 0 | 1;
  private transport: MatchTransport;
  frame = 0;
  pingMs: number | null = null;
  onResync: (() => void) | null = null;
  private captureFrame = INPUT_DELAY + 1;
  private local = new Map<number, number>();
  private remote = new Map<number, number>();
  private localHashes = new Map<number, string>();
  private remoteHashes = new Map<number, string>();
  private repaired = new Set<number>();

  constructor(game: Game, side: 0 | 1, transport: MatchTransport) {
    this.game = game; this.side = side; this.transport = transport;
    for (let frame = 1; frame <= INPUT_DELAY; frame++) { this.local.set(frame, 0); this.remote.set(frame, 0); }
  }

  capture(input: InputFrame): void {
    if (this.captureFrame - this.frame > 120) return;
    const packet: InputPacket = { kind: 'input', frame: this.captureFrame++, bits: packInput(input) };
    this.local.set(packet.frame, packet.bits);
    this.transport.sendInput(packet);
  }

  receiveInput(raw: unknown): void {
    const packet = parseInputPacket(raw);
    if (!packet || packet.frame <= INPUT_DELAY || packet.frame < this.frame - 300 || packet.frame > this.captureFrame + 300) return;
    if (this.remote.has(packet.frame)) return;
    this.remote.set(packet.frame, packet.bits);
  }

  advance(maxSteps = 4): number {
    let steps = 0;
    while (steps < maxSteps && !this.game.seriesWinner && this.local.has(this.frame + 1) && this.remote.has(this.frame + 1)) {
      this.step(); steps++;
    }
    return steps;
  }

  private step(): void {
    const frame = ++this.frame;
    const first = unpackInput((this.side === 0 ? this.local : this.remote).get(frame)!);
    const second = unpackInput((this.side === 1 ? this.local : this.remote).get(frame)!);
    this.game.updateOnline(first, second);
    if (frame % TICK_RATE === 0) {
      const hash = hashText(JSON.stringify(this.game.snapshot()));
      this.localHashes.set(frame, hash);
      this.transport.sendHash({ kind: 'hash', frame, hash });
      this.compare(frame);
    }
    if (frame > 360) {
      this.local.delete(frame - 360); this.remote.delete(frame - 360);
      this.localHashes.delete(frame - 360); this.remoteHashes.delete(frame - 360);
    }
  }

  receiveHash(raw: unknown): void {
    const packet = parseHashPacket(raw);
    if (!packet || packet.frame > this.frame + 300 || packet.frame < this.frame - 300 || packet.frame % TICK_RATE !== 0) return;
    this.remoteHashes.set(packet.frame, packet.hash);
    this.compare(packet.frame);
  }

  private compare(frame: number): void {
    if (this.side !== 0 || this.repaired.has(frame)) return;
    const local = this.localHashes.get(frame), remote = this.remoteHashes.get(frame);
    if (local && remote && local !== remote) {
      this.repaired.add(frame);
      this.transport.sendSnapshot({ kind: 'snapshot', frame: this.frame, state: this.game.snapshot() });
    }
  }

  receiveSnapshot(raw: unknown): void {
    if (this.side !== 1) return;
    const packet = parseSnapshotPacket(raw, this.game);
    if (!packet || packet.frame > this.frame + 300 || packet.frame < this.frame - 300 || packet.state.seed !== this.game.seed) return;
    const oldFrame = this.frame;
    this.game.restore(packet.state);
    this.frame = packet.frame;
    while (this.frame < oldFrame && this.local.has(this.frame + 1) && this.remote.has(this.frame + 1)) this.step();
    this.onResync?.();
  }
}
