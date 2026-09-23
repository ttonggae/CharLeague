import { ANIMATION_FPS, STAGE, TICK_RATE, type MoveData } from './data.ts';
import { animationGroundOffset, animationScale, drawAtlasFrame, fighterAnimation, type LoadedAtlas } from './atlas.ts';
import { Game, type Fighter } from './game.ts';

const W = STAGE.width, H = STAGE.height;

export function attackEffectAnchor(f: Fighter, move: MoveData): { x: number; y: number } {
  return { x: f.x + f.facing * (f.data.width / 2 + move.reach * 0.48), y: f.y - move.height * 0.53 };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private playerAtlas: LoadedAtlas | null;
  private dummyAtlas: LoadedAtlas | null;
  constructor(ctx: CanvasRenderingContext2D, playerAtlas: LoadedAtlas | null, dummyAtlas: LoadedAtlas | null) {
    this.ctx = ctx; this.playerAtlas = playerAtlas; this.dummyAtlas = dummyAtlas;
  }

  draw(game: Game, networkLabel = ''): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.background();
    this.shadow(game.player); this.shadow(game.dummy);
    this.fighter(game.player, this.playerAtlas, game.tick);
    this.fighter(game.dummy, this.dummyAtlas, game.tick);
    this.effect(game.player, this.playerAtlas); this.effect(game.dummy, this.dummyAtlas);
    this.fighterLabel(game.player, 'P1', '#fff');
    this.fighterLabel(game.dummy, 'P2', '#d6d6d6');
    this.hud(game, !!networkLabel);
    if (networkLabel) {
      ctx.fillStyle = '#fff'; ctx.fillRect(752, 111, 190, 28);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(752, 111, 190, 28);
      ctx.fillStyle = '#111'; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(networkLabel, 933, 130); ctx.textAlign = 'left';
    }
    if (game.winner) this.koOverlay(game, !!networkLabel);
  }

  private background(): void {
    const c = this.ctx;
    c.fillStyle = '#f5f5f5'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#aaa'; c.fillRect(18, 186, W - 36, STAGE.floor - 186);
    c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(18, 186, W - 36, STAGE.floor - 186);
    c.fillStyle = '#e8e8e8'; c.fillRect(0, STAGE.floor, W, H - STAGE.floor);
    c.strokeStyle = '#222'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, STAGE.floor); c.lineTo(W, STAGE.floor); c.stroke();
  }

  private shadow(f: Fighter): void {
    const c = this.ctx;
    c.fillStyle = '#4448'; c.beginPath(); c.ellipse(f.x, STAGE.floor + 4, 32, 7, 0, 0, Math.PI * 2); c.fill();
  }

  private fighter(f: Fighter, atlas: LoadedAtlas | null, tick: number): void {
    const animation = fighterAnimation(f);
    const animTick = f.attack ? f.attack.tick : tick;
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
    const x = f.x;
    const y = f.y - f.data.height - 32;
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
    const crouch = f.crouching || (f.guarding && f.crouching);
    const h = crouch ? 62 : f.data.height;
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

  private hud(game: Game, online: boolean): void {
    const c = this.ctx;
    c.fillStyle = '#fff'; c.fillRect(18, 16, 924, 82);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(18, 16, 924, 82);
    this.healthBar(35, 44, game.player.hp / game.player.data.maxHp, '#222', false);
    this.healthBar(567, 44, game.dummy.hp / game.dummy.data.maxHp, '#555', true);
    c.fillStyle = '#111'; c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(game.player.data.name, 37, 38);
    c.textAlign = 'right'; c.fillText(game.dummy.data.name, 923, 38);
    c.textAlign = 'center'; c.font = '800 28px system-ui, sans-serif'; c.fillText('VS', 480, 73);
    if (online) {
      const round = game.roundWins[0] + game.roundWins[1] + (game.winner ? 0 : 1);
      c.font = '700 13px system-ui, sans-serif';
      c.fillText(`ROUND ${round} · P1 ${game.roundWins[0]} : ${game.roundWins[1]} P2`, 480, 37);
    }
    c.font = '700 14px system-ui, sans-serif';
    c.fillText(`${game.player.hp} / ${game.player.data.maxHp}`, 228, 88);
    c.fillText(`${game.dummy.hp} / ${game.dummy.data.maxHp}`, 732, 88);
    if (!game.winner && game.tick - game.noticeTick < 82) {
      c.fillStyle = '#fff'; c.fillRect(364, 115, 232, 48);
      c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(364, 115, 232, 48);
      c.font = '700 22px system-ui, sans-serif'; c.fillStyle = '#111'; c.fillText(game.notice, 480, 147);
    }
    c.textAlign = 'left';
  }

  private healthBar(x: number, y: number, ratio: number, color: string, reverse: boolean): void {
    const c = this.ctx, width = 356;
    c.fillStyle = '#ddd'; c.fillRect(x, y, width, 22);
    c.fillStyle = color;
    const valueWidth = Math.max(0, width * ratio);
    c.fillRect(reverse ? x + width - valueWidth : x, y, valueWidth, 22);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x, y, width, 22);
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
    } else c.fillText('R 또는 다시 시작 버튼을 누르세요', 480, 339);
    c.textAlign = 'left';
  }
}
