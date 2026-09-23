import { joinRoom, type DataPayload, type MessageAction } from 'trystero';
import { parseHashPacket, parseInputPacket, type HashPacket, type InputPacket, type SnapshotPacket } from './online.ts';

export type OnlineRole = 'host' | 'guest';
export type ConnectionState = 'connecting' | 'waiting' | 'connected' | 'disconnected' | 'error';
export type ControlPacket =
  | { kind: 'select'; characterId: string; version: string }
  | { kind: 'ready'; characterId: string; version: string }
  | { kind: 'unready' }
  | { kind: 'start'; p1: string; p2: string; version: string; seed: number }
  | { kind: 'abort'; reason: string };

const appId = 'kr.grimwar.canvasduel.p2p.v1';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const characterId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const version = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function parseControl(raw: unknown): ControlPacket | null {
  if (!object(raw)) return null;
  if (raw.kind === 'unready') return { kind: 'unready' };
  if (raw.kind === 'select' && characterId(raw.characterId) && version(raw.version))
    return { kind: 'select', characterId: raw.characterId, version: raw.version };
  if (raw.kind === 'ready' && characterId(raw.characterId) && version(raw.version))
    return { kind: 'ready', characterId: raw.characterId, version: raw.version };
  if (raw.kind === 'start' && characterId(raw.p1) && characterId(raw.p2) && version(raw.version)
    && Number.isInteger(raw.seed) && (raw.seed as number) >= 0 && (raw.seed as number) <= 0xffffffff)
    return { kind: 'start', p1: raw.p1, p2: raw.p2, version: raw.version, seed: raw.seed as number };
  if (raw.kind === 'abort' && typeof raw.reason === 'string' && raw.reason.length <= 120)
    return { kind: 'abort', reason: raw.reason };
  return null;
}

export interface NetworkCallbacks {
  state(state: ConnectionState, detail?: string): void;
  control(packet: ControlPacket): void;
  input(packet: InputPacket): void;
  hash(packet: HashPacket): void;
  snapshot(packet: SnapshotPacket): void;
  ping(ms: number | null): void;
}

export class P2PConnection {
  role: OnlineRole;
  token: string;
  private callbacks: NetworkCallbacks;
  private room: ReturnType<typeof joinRoom>;
  private controlAction: MessageAction;
  private inputAction: MessageAction;
  private hashAction: MessageAction;
  private snapshotAction: MessageAction;
  private peerId: string | null = null;
  private reservedPeer: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(role: OnlineRole, token: string, callbacks: NetworkCallbacks) {
    this.role = role; this.token = token; this.callbacks = callbacks;
    callbacks.state('connecting');
    this.room = joinRoom({ appId, password: token }, token, {
      handshakeTimeoutMs: 10_000,
      onPeerHandshake: async (peerId, send, receive) => {
        await send({ role });
        const received = await receive();
        if (!object(received.data) || (received.data.role !== 'host' && received.data.role !== 'guest')) throw new Error('상대 역할이 올바르지 않습니다');
        if (received.data.role === role) throw new Error(role === 'guest' ? '방에 이미 두 명이 있습니다' : '다른 호스트가 이미 있습니다');
        if (this.reservedPeer && this.reservedPeer !== peerId) throw new Error('방에 이미 두 명이 있습니다');
        this.reservedPeer = peerId;
      },
      onJoinError: details => {
        if (this.disposed) return;
        if (details.peerId === this.reservedPeer && !this.peerId) this.reservedPeer = null;
        if (this.role === 'guest' || details.peerId === this.peerId) callbacks.state('error', details.error);
      }
    });
    this.controlAction = this.room.makeAction('grim-control');
    this.inputAction = this.room.makeAction('grim-input');
    this.hashAction = this.room.makeAction('grim-hash');
    this.snapshotAction = this.room.makeAction('grim-snapshot');
    this.controlAction.onMessage = (raw, context) => {
      if (!this.fromPeer(context.peerId)) return;
      const packet = parseControl(raw);
      if (packet) callbacks.control(packet);
    };
    this.inputAction.onMessage = (raw, context) => {
      if (!this.fromPeer(context.peerId)) return;
      const packet = parseInputPacket(raw);
      if (packet) callbacks.input(packet);
    };
    this.hashAction.onMessage = (raw, context) => {
      if (!this.fromPeer(context.peerId)) return;
      const packet = parseHashPacket(raw);
      if (packet) callbacks.hash(packet);
    };
    this.snapshotAction.onMessage = (raw, context) => {
      if (!this.fromPeer(context.peerId)) return;
      // Full value validation uses the current game's character definitions in OnlineMatch.
      if (object(raw) && raw.kind === 'snapshot') callbacks.snapshot(raw as unknown as SnapshotPacket);
    };
    this.room.onPeerJoin = peerId => {
      if (this.disposed || (this.peerId && this.peerId !== peerId)) return;
      this.peerId = peerId;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      callbacks.state('connected');
      this.pingTimer = setInterval(() => { void this.measurePing(); }, 2_000);
      void this.measurePing();
    };
    this.room.onPeerLeave = peerId => {
      if (this.disposed || peerId !== this.peerId) return;
      this.peerId = null; this.reservedPeer = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      callbacks.ping(null);
      callbacks.state('disconnected', '상대가 연결을 종료했습니다');
    };
    if (role === 'host') callbacks.state('waiting');
    else this.connectTimer = setTimeout(() => { if (!this.peerId && !this.disposed) callbacks.state('error', '연결 시간이 초과됐습니다'); }, 25_000);
  }

  get connected(): boolean { return !!this.peerId && !this.disposed; }
  private fromPeer(peerId: string): boolean { return !this.disposed && peerId === this.peerId; }
  private send(action: typeof this.controlAction, packet: DataPayload): void {
    if (!this.peerId || this.disposed) return;
    void action.send(packet, { target: this.peerId }).catch(error => {
      if (!this.disposed) this.callbacks.state('error', error instanceof Error ? error.message : String(error));
    });
  }
  sendControl(packet: ControlPacket): void { this.send(this.controlAction, packet as unknown as DataPayload); }
  sendInput(packet: InputPacket): void { this.send(this.inputAction, packet as unknown as DataPayload); }
  sendHash(packet: HashPacket): void { this.send(this.hashAction, packet as unknown as DataPayload); }
  sendSnapshot(packet: SnapshotPacket): void { this.send(this.snapshotAction, packet as unknown as DataPayload); }

  private async measurePing(): Promise<void> {
    if (!this.peerId || this.disposed) return;
    try {
      const ms = await this.room.ping(this.peerId);
      if (!this.disposed && this.peerId) this.callbacks.ping(Math.round(ms));
    } catch { if (!this.disposed) this.callbacks.ping(null); }
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.peerId = null; this.reservedPeer = null;
    this.controlAction.onMessage = null; this.inputAction.onMessage = null;
    this.hashAction.onMessage = null; this.snapshotAction.onMessage = null;
    this.room.onPeerJoin = null; this.room.onPeerLeave = null;
    await this.room.leave();
  }
}
