import { ANIMATION_FPS, STAGE, TICK_RATE, VIEWPORT, WORLD_SCALE, type MoveData } from './data.ts';
import { animationGroundOffset, animationScale, drawAtlasFrame, fighterAnimation, fighterAnimationTick, type LoadedAtlas } from './atlas.ts';
import { Game, type Fighter } from './game.ts';
import { isUltimateMove, isUltimateReady, ultimateStatus } from './abilities.ts';

const W = VIEWPORT.width, H = VIEWPORT.height;

export function attackEffectAnchor(f: Fighter, move: MoveData): { x: number; y: number } {
  return { x: f.x + f.facing * (f.data.width / 2 + move.reach * 0.48), y: f.y - move.height * 0.53 };
}

export type SkillStatusReason = 'ready' | 'active' | 'cooldown' | 'ko' | 'stun' | 'hurt' | 'busy' | 'stamina' | 'condition';
export interface SkillStatus { available: boolean; label: string; remainingTicks: number; reason: SkillStatusReason }

export function skillStatus(fighter: Fighter, move: MoveData, tick: number): SkillStatus {
  if (move.kind === 'guard' && fighter.guarding) return { available: false, label: '사용 중', remainingTicks: 0, reason: 'active' };
  if (fighter.attack?.move.id === move.id) return { available: false, label: '사용 중', remainingTicks: 0, reason: 'active' };
  const remainingTicks = Math.max(0, fighter.cooldowns[move.id] - tick);
  if (remainingTicks > 0) return { available: false, label: `쿨 ${Math.ceil(remainingTicks / 6) / 10}초`, remainingTicks, reason: 'cooldown' };
  if (fighter.hp <= 0) return { available: false, label: 'K.O.', remainingTicks: 0, reason: 'ko' };
  if (fighter.stunTicks > 0) return { available: false, label: '기절 중', remainingTicks: 0, reason: 'stun' };
  if (fighter.hurtTicks > 0) return { available: false, label: '피격 중', remainingTicks: 0, reason: 'hurt' };
  if (fighter.attack) return { available: false, label: '행동 중', remainingTicks: 0, reason: 'busy' };
  if (move.kind === 'guard' && fighter.stamina <= 0) return { available: false, label: '기력 부족', remainingTicks: 0, reason: 'stamina' };
  if (fighter.stamina < move.staminaCost) return { available: false, label: '기력 부족', remainingTicks: 0, reason: 'stamina' };
  if (isUltimateMove(fighter, move) && !isUltimateReady(fighter)) {
    const target = fighter.data.ultimate?.condition.target ?? 0;
    return { available: false, label: `조건 ${Math.floor(fighter.ultimateProgress)}/${target}`, remainingTicks: 0, reason: 'condition' };
  }
  return { available: true, label: '사용 가능', remainingTicks: 0, reason: 'ready' };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private playerAtlas: LoadedAtlas | null;
  private dummyAtlas: LoadedAtlas | null;
  constructor(ctx: CanvasRenderingContext2D, playerAtlas: LoadedAtlas | null, dummyAtlas: LoadedAtlas | null) {
    this.ctx = ctx; this.playerAtlas = playerAtlas; this.dummyAtlas = dummyAtlas;
  }

  draw(game: Game, networkLabel = '', viewerSide: 0 | 1 = 0): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.background();
    ctx.save(); ctx.scale(WORLD_SCALE, WORLD_SCALE);
    this.shadow(game.player); this.shadow(game.dummy);
    this.fighter(game.player, this.playerAtlas, game.tick);
    this.fighter(game.dummy, this.dummyAtlas, game.tick);
    this.effect(game.player, this.playerAtlas); this.effect(game.dummy, this.dummyAtlas);
    this.projectiles(game);
    this.readyEffect(game.player, this.playerAtlas); this.readyEffect(game.dummy, this.dummyAtlas);
    ctx.restore();
    this.stunLabel(game.player); this.stunLabel(game.dummy);
    this.fighterLabel(game.player, 'P1', '#fff');
    this.fighterLabel(game.dummy, 'P2', '#d6d6d6');
    this.hud(game, !!networkLabel, viewerSide);
    if (networkLabel) {
      ctx.fillStyle = '#fff'; ctx.fillRect(752, 126, 190, 28);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(752, 126, 190, 28);
      ctx.fillStyle = '#111'; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(networkLabel, 933, 145); ctx.textAlign = 'left';
    }
    if (game.winner) this.koOverlay(game, !!networkLabel);
  }

  private background(): void {
    const c = this.ctx;
    c.fillStyle = '#f5f5f5'; c.fillRect(0, 0, W, H);
    const floor = STAGE.floor * WORLD_SCALE;
    c.fillStyle = '#aaa'; c.fillRect(18, 186, W - 36, floor - 186);
    c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(18, 186, W - 36, floor - 186);
    c.fillStyle = '#e8e8e8'; c.fillRect(0, floor, W, H - floor);
    c.strokeStyle = '#222'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, floor); c.lineTo(W, floor); c.stroke();
  }

  private shadow(f: Fighter): void {
    const c = this.ctx;
    c.fillStyle = '#4448'; c.beginPath(); c.ellipse(f.x, STAGE.floor + 4, 32, 7, 0, 0, Math.PI * 2); c.fill();
  }

  private fighter(f: Fighter, atlas: LoadedAtlas | null, tick: number): void {
    const animation = fighterAnimation(f);
    const animTick = fighterAnimationTick(f);
    const scale = f.data.spriteScale ?? animationScale(atlas, 'idle', f.data.height);
    const anchorY = f.y - animationGroundOffset(atlas, 'idle', scale, f.data.height);
    if (f.attack?.move.bodyAnimationMode === 'overlay') {
      const baseDrawn = drawAtlasFrame(this.ctx, atlas, 'characters', 'idle', tick, f.x, anchorY, f.facing, scale);
      const overlayDrawn = drawAtlasFrame(this.ctx, atlas, 'characters', animation, animTick, f.x, anchorY, f.facing, scale);
      if (baseDrawn || overlayDrawn) return;
    }
    if (drawAtlasFrame(this.ctx, atlas, 'characters', animation, animTick, f.x, anchorY, f.facing, scale)) return;
    if (f.attack && drawAtlasFrame(this.ctx, atlas, 'characters', 'attack', animTick, f.x, anchorY, f.facing, scale)) return;
    if (drawAtlasFrame(this.ctx, atlas, 'characters', 'idle', tick, f.x, anchorY, f.facing, scale)) return;
    if (!atlas) this.boxFighter(f, tick);
  }

  private fighterLabel(f: Fighter, label: string, color: string): void {
    const c = this.ctx;
    const x = f.x * WORLD_SCALE;
    const y = (f.y - f.data.height) * WORLD_SCALE - 32;
    c.save();
    c.fillStyle = color; c.fillRect(x - 19, y - 11, 38, 23);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x - 19, y - 11, 38, 23);
    c.fillStyle = '#111'; c.font = '800 14px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + 1);
    c.restore();
  }

  private boxFighter(f: Fighter, tick: number): void {
    const c = this.ctx;
    const fill = '#777';
    const dark = '#222';
    const lit = '#eee';
    const h = f.data.height;
    const bob = f.state === 'idle' ? Math.floor(tick / (TICK_RATE / ANIMATION_FPS)) % 2 : 0;
    c.save(); c.translate(f.x, f.y - bob); c.scale(f.facing, 1);
    if (f.state === 'hurt') c.globalAlpha = Math.floor(tick / 3) % 2 ? 0.52 : 1;
    if (f.state === 'ko') { c.translate(0, -18); c.rotate(Math.PI / 2.8); }
    c.fillStyle = dark; c.fillRect(-21, -h + 24, 42, h - 24);
    c.fillStyle = fill; c.fillRect(-17, -h + 28, 34, h - 44);
    c.fillStyle = lit; c.fillRect(-14, -h, 28, 26); c.strokeStyle = dark; c.lineWidth = 2; c.strokeRect(-14, -h, 28, 26);
    c.fillStyle = '#111'; c.fillRect(4, -h + 8, 8, 5);
    c.fillRect(-18, -15, 15, 15); c.fillRect(4, -15, 15, 15);
    c.fillStyle = lit;
    const arm = f.attack ? Math.floor(f.attack.tick / 5) % 2 ? 30 : 22 : f.guarding ? 14 : 10;
    c.fillRect(13, -h + 34, arm, 13);
    if (f.guarding) {
      c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.arc(12, -h / 2, 36, -1.3, 1.3); c.stroke();
    }
    c.restore();
  }

  private effect(f: Fighter, atlas: LoadedAtlas | null): void {
    const attack = f.attack;
    if (!attack) return;
    const { move, tick } = attack;
    if (move.kind === 'projectile' || move.kind === 'guard') return;
    if (tick < move.startup || tick >= move.startup + move.active) return;
    const { x, y } = attackEffectAnchor(f, move);
    const scale = f.data.spriteScale ?? animationScale(atlas, 'idle', f.data.height);
    if (drawAtlasFrame(this.ctx, atlas, 'effects', move.effectAnimation ?? move.effect, tick - move.startup, x, y, f.facing, scale)) return;
    if (atlas) return;
    const c = this.ctx;
    const frame = Math.floor((tick - move.startup) / (TICK_RATE / ANIMATION_FPS));
    c.save(); c.translate(x, y); c.scale(f.facing, 1);
    c.globalAlpha = frame === 0 ? 0.9 : 0.7;
    c.strokeStyle = '#111'; c.lineWidth = frame === 0 ? 14 : 9;
    c.beginPath(); c.ellipse(0, 0, move.reach * 0.43, move.height * 0.42, -0.3, -1.15, 1.15); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = frame === 0 ? 9 : 5; c.stroke();
    c.fillStyle = '#111'; c.fillRect(-5, -move.height * 0.25, move.reach * 0.55, 5);
    c.restore();
  }

  private projectiles(game: Game): void {
    for (const projectile of game.projectiles) {
      const fighter = projectile.owner === 0 ? game.player : game.dummy;
      const atlas = projectile.owner === 0 ? this.playerAtlas : this.dummyAtlas;
      const move = fighter.data.moves.find(candidate => candidate.id === projectile.moveId);
      if (!move?.projectile) continue;
      const facing: -1 | 1 = projectile.vx < 0 ? -1 : 1;
      const scale = fighter.data.spriteScale ?? animationScale(atlas, 'idle', fighter.data.height);
      if (drawAtlasFrame(this.ctx, atlas, 'effects', move.effectAnimation ?? move.effect, projectile.age, projectile.x, projectile.y, facing, scale)) continue;
      const c = this.ctx;
      c.save(); c.translate(projectile.x, projectile.y); c.scale(facing, 1);
      c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 3;
      c.fillRect(-move.projectile.width / 2, -move.projectile.height / 2, move.projectile.width, move.projectile.height);
      c.strokeRect(-move.projectile.width / 2, -move.projectile.height / 2, move.projectile.width, move.projectile.height);
      c.restore();
    }
  }

  private readyEffect(fighter: Fighter, atlas: LoadedAtlas | null): void {
    const key = fighter.data.ultimate?.readyEffectAnimation;
    if (fighter.ultimateReadyEffectTick === null || !key) return;
    const scale = fighter.data.spriteScale ?? animationScale(atlas, 'idle', fighter.data.height);
    drawAtlasFrame(this.ctx, atlas, 'effects', key, fighter.ultimateReadyEffectTick, fighter.x, fighter.y - fighter.data.height - 22, 1, scale);
  }

  private stunLabel(fighter: Fighter): void {
    if (fighter.stunTicks <= 0) return;
    const c = this.ctx;
    c.save(); c.textAlign = 'center'; c.font = '800 12px system-ui, sans-serif';
    const x = fighter.x * WORLD_SCALE, y = (fighter.y - fighter.data.height) * WORLD_SCALE - 62;
    c.fillStyle = '#fff'; c.fillRect(x - 25, y, 50, 20);
    c.strokeStyle = '#111'; c.lineWidth = 1; c.strokeRect(x - 25, y, 50, 20);
    c.fillStyle = '#111'; c.fillText('기절', x, y + 15); c.restore();
  }

  private hud(game: Game, online: boolean, viewerSide: 0 | 1): void {
    const c = this.ctx;
    c.fillStyle = '#fff'; c.fillRect(18, 16, 924, 102);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(18, 16, 924, 102);
    this.healthBar(35, 44, game.player.hp / game.player.data.maxHp, '#222', false);
    this.healthBar(567, 44, game.dummy.hp / game.dummy.data.maxHp, '#555', true);
    this.staminaBar(35, 73, game.player.stamina / game.player.data.maxStamina, false, !!game.player.data.ultimate && game.player.ultimateProgress >= game.player.data.ultimate.condition.target);
    this.staminaBar(567, 73, game.dummy.stamina / game.dummy.data.maxStamina, true, !!game.dummy.data.ultimate && game.dummy.ultimateProgress >= game.dummy.data.ultimate.condition.target);
    c.fillStyle = '#111'; c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(game.player.data.name, 37, 38);
    c.textAlign = 'right'; c.fillText(game.dummy.data.name, 923, 38);
    c.textAlign = 'center'; c.font = '800 28px system-ui, sans-serif'; c.fillText('VS', 480, 69);
    if (online) {
      const round = game.roundWins[0] + game.roundWins[1] + (game.winner ? 0 : 1);
      c.font = '700 13px system-ui, sans-serif';
      c.fillText(`ROUND ${round} · P1 ${game.roundWins[0]} : ${game.roundWins[1]} P2`, 480, 37);
    } else {
      c.font = '700 10px system-ui, sans-serif';
      c.fillText('R 재시작 · Esc 나가기', 480, 105);
    }
    c.font = '700 12px system-ui, sans-serif';
    c.fillText(`HP ${game.player.hp} · 기력 ${Math.ceil(game.player.stamina)}${ultimateStatus(game.player) ? ` · ${ultimateStatus(game.player)}` : ''}`, 213, 105);
    c.fillText(`HP ${game.dummy.hp} · 기력 ${Math.ceil(game.dummy.stamina)}${ultimateStatus(game.dummy) ? ` · ${ultimateStatus(game.dummy)}` : ''}`, 747, 105);
    const localFighter = viewerSide === 0 ? game.player : game.dummy;
    const guardMove = localFighter.guarding ? localFighter.data.moves.find(move => move.kind === 'guard') : undefined;
    const notice = localFighter.attack?.move.label ?? guardMove?.label ?? (game.tick - game.noticeTick < 82 ? game.notice : null);
    if (!game.winner && notice) {
      c.fillStyle = '#fff'; c.fillRect(364, 126, 232, 48);
      c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(364, 126, 232, 48);
      c.font = '700 22px system-ui, sans-serif'; c.fillStyle = '#111'; c.fillText(notice, 480, 158);
    }
    this.skillList(localFighter, game.tick);
    c.textAlign = 'left';
  }

  private skillList(fighter: Fighter, tick: number): void {
    const moves = fighter.data.moves;
    if (!moves.length) return;
    const c = this.ctx;
    const gap = 6;
    const width = Math.min(118, (W - 36 - gap * (moves.length - 1)) / moves.length);
    const height = 40;
    const total = width * moves.length + gap * (moves.length - 1);
    const startX = (W - total) / 2;
    c.save();
    c.textBaseline = 'middle';
    moves.forEach((move, index) => {
      const x = startX + index * (width + gap), y = 493;
      const state = skillStatus(fighter, move, tick);
      const dimmed = ['ko', 'stun', 'hurt', 'stamina', 'condition'].includes(state.reason);
      c.globalAlpha = dimmed ? 0.42 : 1;
      c.fillStyle = '#fff'; c.fillRect(x, y, width, height);
      c.strokeStyle = '#111'; c.lineWidth = state.reason === 'active' ? 2 : 1; c.strokeRect(x, y, width, height);
      c.fillStyle = '#111'; c.fillRect(x + 5, y + 5, 35, 15);
      c.fillStyle = '#fff'; c.font = '800 9px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(this.commandLabel(move), x + 22.5, y + 12.5);
      c.fillStyle = '#111'; c.font = '800 10px system-ui, sans-serif'; c.textAlign = 'left';
      c.fillText(move.label, x + 46, y + 13, Math.max(18, width - 51));
      const cost = move.kind === 'guard' ? `초당 ${move.guardStaminaPerSecond ?? 0}` : `기력 ${move.staminaCost}`;
      c.font = '700 9px system-ui, sans-serif'; c.fillText(`${state.label} · ${cost}`, x + 5, y + 30, width - 10);
      c.globalAlpha = 1;
      if (state.reason === 'cooldown' && (move.cooldown ?? 0) > 0) {
        const ratio = Math.min(1, state.remainingTicks / (move.cooldown ?? 1));
        c.fillStyle = '#555'; c.globalAlpha = 0.48; c.fillRect(x, y, width * ratio, height); c.globalAlpha = 1;
        c.strokeStyle = '#111'; c.lineWidth = 1; c.strokeRect(x, y, width, height);
      }
    });
    c.restore();
  }

  private commandLabel(move: MoveData): string {
    const direction = { any: '', forward: '→+', back: '←+', up: '↑+', down: '↓+' }[move.direction];
    return `${direction}${move.sequence.join('→')}`;
  }

  private healthBar(x: number, y: number, ratio: number, color: string, reverse: boolean): void {
    const c = this.ctx, width = 356;
    c.fillStyle = '#ddd'; c.fillRect(x, y, width, 22);
    c.fillStyle = color;
    const valueWidth = Math.max(0, width * ratio);
    c.fillRect(reverse ? x + width - valueWidth : x, y, valueWidth, 22);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x, y, width, 22);
  }

  private staminaBar(x: number, y: number, ratio: number, reverse: boolean, ultimateReady: boolean): void {
    const c = this.ctx, width = 356;
    c.fillStyle = '#eee'; c.fillRect(x, y, width, 12);
    c.fillStyle = ultimateReady ? '#111' : '#777';
    const valueWidth = Math.max(0, width * ratio);
    c.fillRect(reverse ? x + width - valueWidth : x, y, valueWidth, 12);
    c.strokeStyle = '#111'; c.lineWidth = ultimateReady ? 2 : 1; c.strokeRect(x, y, width, 12);
  }

  private koOverlay(game: Game, online: boolean): void {
    const c = this.ctx;
    c.fillStyle = '#ffffffe6'; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.fillStyle = '#111'; c.font = '900 90px system-ui, sans-serif'; c.fillText('K.O.!', 480, 251);
    c.font = '700 27px system-ui, sans-serif'; c.fillText(online ? (game.winner === 'player' ? 'P1 WINS' : 'P2 WINS') : (game.winner === 'player' ? 'PLAYER WINS' : 'DUMMY WINS'), 480, 293);
    c.font = '18px system-ui, sans-serif';
    if (online) {
      c.fillText(`P1 ${game.roundWins[0]} : ${game.roundWins[1]} P2`, 480, 337);
      c.fillText(game.roundWins.includes(2) ? '3초 후 캐릭터 선택' : '3초 후 다음 라운드', 480, 369);
    } else c.fillText('R 키로 다시 시작', 480, 339);
    c.textAlign = 'left';
  }
}
