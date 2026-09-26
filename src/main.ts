import './style.css';
import { animationGroundOffset, animationScale, drawAtlasFrame } from './atlas.ts';
import { loadRoster, type CharacterEntry } from './characters.ts';
import { TICK_RATE } from './data.ts';
import { Game, type DummyMode } from './game.ts';
import { KeyboardInput } from './input.ts';
import { P2PConnection, type ConnectionState, type ControlPacket, type OnlineRole } from './network.ts';
import { createInviteToken, inviteUrl, OnlineMatch, rosterVersion, tokenFromFragment, type InputPacket } from './online.ts';
import { Renderer } from './render.ts';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} 요소를 찾을 수 없습니다`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#game');
const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
if (!context) throw new Error('Canvas 2D를 사용할 수 없습니다');
const drawContext: CanvasRenderingContext2D = context;
const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;
const input = new KeyboardInput();
const menuScreen = required<HTMLElement>('#main-menu');
const selectionScreen = required<HTMLElement>('#selection-screen');
const arenaScreen = required<HTMLElement>('#arena-screen');
const guide = required<HTMLElement>('.guide');
const issuePanel = required<HTMLElement>('#roster-issues');
const startButton = required<HTMLButtonElement>('#start-fight');
const status = required<HTMLElement>('#game-status');
const onlineLobby = required<HTMLElement>('#online-lobby');
const connectionStatus = required<HTMLElement>('#connection-status');
const onlinePing = required<HTMLElement>('#online-ping');
const inviteField = required<HTMLInputElement>('#invite-link');
const inviteRow = required<HTMLElement>('.invite-row');
const retryButton = required<HTMLButtonElement>('#online-retry');
const countdownText = required<HTMLElement>('#online-countdown');
const disconnectOverlay = required<HTMLElement>('#online-disconnect');
const disconnectReason = required<HTMLElement>('#disconnect-reason');
const previewCanvases = [required<HTMLCanvasElement>('#player-preview'), required<HTMLCanvasElement>('#dummy-preview')];

type Mode = 'menu' | 'local' | 'online';
interface Countdown { p1: string; p2: string; seed: number; until: number }
let mode: Mode = 'menu';
let entries: CharacterEntry[] = [];
let version = '';
let chosen: [CharacterEntry | null, CharacterEntry | null] = [null, null];
let game: Game | null = null;
let renderer: Renderer | null = null;
let match: OnlineMatch | null = null;
let connection: P2PConnection | null = null;
let connectionGeneration = 0;
let connectionClose: Promise<void> = Promise.resolve();
let onlineRole: OnlineRole = 'host';
let onlineToken = '';
let connectionState: ConnectionState = 'connecting';
let connectionDetail = '';
let pingMs: number | null = null;
let localReady = false;
let remoteReady: { characterId: string; version: string } | null = null;
let countdown: Countdown | null = null;
let earlyInputs: InputPacket[] = [];
let previewTick = 0;

function resizeGameCanvas(): void {
  if (arenaScreen.hidden) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(GAME_WIDTH, Math.round(rect.width * dpr));
  const height = Math.max(GAME_HEIGHT, Math.round(rect.height * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width; canvas.height = height;
  drawContext.setTransform(width / GAME_WIDTH, 0, 0, height / GAME_HEIGHT, 0, 0);
  drawContext.imageSmoothingEnabled = false;
}

function label(entry: CharacterEntry): string { return entry.data?.name ?? entry.id; }
function findCharacter(id: string): CharacterEntry | null { return entries.find(entry => entry.id === id && entry.data) ?? null; }
function renderIssues(globalIssues: string[]): void {
  const all = [...globalIssues, ...entries.flatMap(entry => entry.issues)];
  issuePanel.replaceChildren(); issuePanel.hidden = all.length === 0;
  if (!all.length) return;
  const heading = document.createElement('strong'); heading.textContent = `캐릭터 파일 알림 · ${all.length}건`; issuePanel.append(heading);
  for (const message of [...new Set(all)]) { const line = document.createElement('p'); line.textContent = message; issuePanel.append(line); }
}

function renderChoice(side: 0 | 1): void {
  const prefix = (mode === 'online' && onlineRole === 'guest' ? side === 0 ? 'dummy' : 'player'
    : side === 0 ? 'player' : 'dummy');
  const list = required<HTMLElement>(`#${prefix}-options`); list.replaceChildren();
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'character-card';
    button.classList.toggle('selected', chosen[side] === entry);
    button.disabled = !entry.data || (mode === 'online' && side === 1);
    button.setAttribute('aria-pressed', String(chosen[side] === entry));
    if (entry.portraitUrl) {
      const image = document.createElement('img'); image.src = entry.portraitUrl; image.alt = '';
      const portrait = document.createElement('span'); portrait.className = 'portrait-window'; portrait.append(image); button.append(portrait);
    } else {
      const fallback = document.createElement('span'); fallback.className = 'portrait-fallback'; fallback.textContent = 'X';
      fallback.setAttribute('aria-label', '초상화 없음'); button.append(fallback);
    }
    const info = document.createElement('span'); info.className = 'character-card-info';
    const name = document.createElement('strong'); name.textContent = label(entry); info.append(name);
    const stats = document.createElement('small');
    stats.textContent = entry.data ? `HP ${entry.data.maxHp} · 기력 ${entry.data.maxStamina} · 이동 ${entry.data.walkSpeed}` : 'character.json 오류';
    info.append(stats); button.append(info);
    if (chosen[side] === entry) {
      const marker = document.createElement('span'); marker.className = 'selection-marker'; marker.textContent = '선택됨';
      button.append(marker);
    }
    if (entry.issues.length) { const warning = document.createElement('span'); warning.className = 'card-warning'; warning.textContent = '⚠'; warning.title = entry.issues.join('\n'); button.append(warning); }
    button.addEventListener('click', () => {
      if (chosen[side] === entry) return;
      if (mode === 'online' && side === 0 && localReady) setLocalReady(false);
      chosen[side] = entry; renderChoice(side);
      if (mode === 'online' && side === 0 && connection?.connected)
        connection.sendControl({ kind: 'select', characterId: entry.id, version });
    });
    list.append(button);
  }
  const entry = chosen[side];
  required<HTMLElement>(`#${prefix}-name`).textContent = entry ? label(entry) : mode === 'online' && side === 1 ? '상대 선택 대기' : '선택 대기';
  required<HTMLElement>(`#${prefix}-description`).textContent = entry?.data?.description ?? '';
  required<HTMLElement>(`#${prefix}-stats`).textContent = entry?.data
    ? `체력 ${entry.data.maxHp} · 기력 ${entry.data.maxStamina} · 이동 ${entry.data.walkSpeed} · 점프 ${entry.data.jumpSpeed}` : '';
  if (side === 0) {
    const available = required<HTMLElement>('#available-moves'); available.replaceChildren();
    const directions = { any: '', forward: '전방 + ', back: '후방 + ', up: '↑ + ', down: '↓ + ' };
    for (const move of entry?.data?.moves ?? []) {
      const ultimate = entry?.data?.ultimate?.moveId === move.id ? '궁극기 · ' : '';
      const line = document.createElement('p'); line.textContent = `${directions[move.direction]}${move.sequence.join(' → ')} · ${ultimate}${move.label} · 기력 ${move.staminaCost}`; available.append(line);
    }
    if (entry?.data) {
      const passive = document.createElement('p'); passive.textContent = `패시브 · ${entry.data.passive.name}: ${entry.data.passive.description}`; available.prepend(passive);
      if (entry.data.ultimate) {
        const conditionNames = { landHits: '공격 적중', takeDamage: '피해 받기', spendStamina: '기력 소모' };
        const ultimate = document.createElement('p'); ultimate.textContent = `궁극기 조건 · ${conditionNames[entry.data.ultimate.condition.type]} ${entry.data.ultimate.condition.target}`; available.append(ultimate);
      } else if (entry.data.moves.some(move => move.id === 'Space')) {
        const ordinarySpace = document.createElement('p'); ordinarySpace.textContent = 'Space는 일반 스킬'; available.append(ordinarySpace);
      }
    }
    if (!available.childElementCount) { const line = document.createElement('p'); line.textContent = '등록된 공격 기술 없음'; available.append(line); }
  }
  startButton.disabled = mode === 'online' ? !chosen[0]?.data || !connection?.connected || !!countdown
    : !chosen[0]?.data || !chosen[1]?.data;
}

function drawPreview(side: 0 | 1): void {
  const canvas = previewCanvases[side], ctx = canvas.getContext('2d'); if (!ctx) return;
  const choiceSide = mode === 'online' && onlineRole === 'guest' ? (1 - side) as 0 | 1 : side;
  const entry = chosen[choiceSide]; ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#aaa'; ctx.fillRect(12, 18, 146, 153);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(12, 18, 146, 153);
  ctx.beginPath(); ctx.moveTo(12, 171); ctx.lineTo(158, 171); ctx.stroke();
  if (!entry?.data) return;
  const data = entry.data;
  const scale = data.spriteScale ?? animationScale(entry.atlas, 'idle', data.height);
  if (drawAtlasFrame(ctx, entry.atlas, 'characters', 'idle', previewTick, 85, 170 - animationGroundOffset(entry.atlas, 'idle', scale, data.height), side === 0 ? 1 : -1, scale)) return;
  if (entry.atlas) return;
  ctx.fillStyle = '#777'; ctx.fillRect(66, 170 - data.height, 38, data.height);
  ctx.fillStyle = '#eee'; ctx.fillRect(70, 170 - data.height, 30, 27);
}

function showArena(): void {
  menuScreen.hidden = true; selectionScreen.hidden = true; arenaScreen.hidden = false; guide.hidden = true;
  document.body.classList.add('playing');
  input.read();
  resizeGameCanvas();
  requestAnimationFrame(resizeGameCanvas);
}
function hideArena(): void {
  game = null; renderer = null; match = null;
  disconnectOverlay.hidden = true; arenaScreen.hidden = true;
  document.body.classList.remove('playing');
}
async function stopConnection(): Promise<void> {
  connectionGeneration++;
  const old = connection; connection = null; match = null; countdown = null;
  earlyInputs = [];
  connectionClose = connectionClose.then(async () => {
    if (old) await old.close();
  }).catch(error => console.error('P2P 종료 실패', error));
  await connectionClose;
}
function clearFragment(): void { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
function enterMenu(): void {
  void stopConnection(); hideArena(); clearFragment(); sessionStorage.removeItem('grim-host-token'); mode = 'menu';
  menuScreen.hidden = false; selectionScreen.hidden = true; guide.hidden = true;
}
function enterLocal(): void {
  void stopConnection(); hideArena(); clearFragment(); sessionStorage.removeItem('grim-host-token'); mode = 'local';
  const valid = entries.filter(entry => entry.data);
  chosen = [valid[0] ?? null, valid[1] ?? valid[0] ?? null];
  required<HTMLElement>('#selection-heading').textContent = '연습 모드';
  required<HTMLElement>('#selection-description').textContent = '플레이어와 상대 더미를 각각 선택하세요.';
  required<HTMLElement>('#player-title').textContent = '플레이어';
  required<HTMLElement>('#opponent-title').textContent = '상대 더미';
  startButton.textContent = '대전 시작 ↗';
  onlineLobby.hidden = true; menuScreen.hidden = true; selectionScreen.hidden = false; guide.hidden = false;
  renderChoice(0); renderChoice(1);
}

function setConnectionState(state: ConnectionState, detail = ''): void {
  connectionState = state; connectionDetail = detail;
  const labels = { connecting: '연결 중', waiting: '상대 대기 중', connected: '연결 완료', disconnected: '연결 끊김', error: '연결 실패' };
  connectionStatus.textContent = `${labels[state]}${detail ? ` · ${detail}` : ''}`;
  retryButton.hidden = state !== 'disconnected' && state !== 'error';
  if (state === 'disconnected' || state === 'error') {
    countdown = null; localReady = false; remoteReady = null;
    chosen[1] = null; renderChoice(1);
    if (game && mode === 'online') { disconnectReason.textContent = connectionStatus.textContent; disconnectOverlay.hidden = false; }
  }
  startButton.textContent = localReady ? '준비 취소' : '준비';
  renderChoice(0);
}

function cancelCountdown(): void { countdown = null; countdownText.hidden = true; renderChoice(0); }
function setLocalReady(ready: boolean): void {
  if (!connection?.connected || !chosen[0]?.data || mode !== 'online') return;
  localReady = ready;
  if (ready) connection.sendControl({ kind: 'ready', characterId: chosen[0].id, version });
  else { connection.sendControl({ kind: 'unready' }); cancelCountdown(); }
  startButton.textContent = ready ? '준비 취소' : '준비';
  maybeStart();
}
function maybeStart(): void {
  if (onlineRole !== 'host' || !connection?.connected || !localReady || !remoteReady || countdown || !chosen[0]?.data) return;
  if (remoteReady.version !== version || !findCharacter(remoteReady.characterId)) {
    setConnectionState('error', '캐릭터 데이터 버전 또는 파일이 다릅니다'); return;
  }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const start: ControlPacket = { kind: 'start', p1: chosen[0].id, p2: remoteReady.characterId, version, seed };
  connection.sendControl(start);
  beginCountdown(start);
}
function beginCountdown(packet: Extract<ControlPacket, { kind: 'start' }>): void {
  countdown = { p1: packet.p1, p2: packet.p2, seed: packet.seed, until: performance.now() + 3_000 };
  countdownText.hidden = false; countdownText.textContent = '3초 후 시작';
  renderChoice(0);
}
function receiveControl(packet: ControlPacket): void {
  if (mode !== 'online') return;
  if (packet.kind === 'select' || packet.kind === 'ready') {
    if (packet.version !== version || !findCharacter(packet.characterId)) {
      setConnectionState('error', '상대 캐릭터 파일 또는 게임 데이터 버전이 다릅니다');
      connection?.sendControl({ kind: 'abort', reason: '데이터 버전 불일치' }); return;
    }
    remoteReady = packet.kind === 'ready' ? packet : null;
    chosen[1] = findCharacter(packet.characterId); renderChoice(1); maybeStart();
    if (packet.kind === 'select') cancelCountdown();
  } else if (packet.kind === 'unready') {
    remoteReady = null; cancelCountdown();
  } else if (packet.kind === 'abort') {
    setConnectionState('error', packet.reason);
  } else if (packet.kind === 'start' && onlineRole === 'guest') {
    if (!localReady || !remoteReady || packet.version !== version || packet.p1 !== remoteReady.characterId || packet.p2 !== chosen[0]?.id) {
      setConnectionState('error', '시작 정보가 캐릭터 선택과 다릅니다'); return;
    }
    beginCountdown(packet);
  }
}

function startOnlineFight(config: Countdown): void {
  const p1 = findCharacter(config.p1), p2 = findCharacter(config.p2);
  if (!p1?.data || !p2?.data || !connection?.connected) { setConnectionState('error', '선택 캐릭터 또는 연결을 확인할 수 없습니다'); return; }
  game = new Game(p1.data, p2.data, config.seed, true);
  renderer = new Renderer(drawContext, p1.atlas, p2.atlas);
  match = new OnlineMatch(game, onlineRole === 'host' ? 0 : 1, {
    sendInput: packet => connection?.sendInput(packet),
    sendHash: packet => connection?.sendHash(packet),
    sendSnapshot: packet => connection?.sendSnapshot(packet)
  });
  match.onResync = () => { status.textContent = '상태 동기화 복구'; };
  for (const packet of earlyInputs) match.receiveInput(packet);
  earlyInputs = [];
  countdown = null; countdownText.hidden = true; showArena();
}

function finishOnlineSeries(): void {
  if (!game?.seriesWinner || mode !== 'online') return;
  const winner = game.seriesWinner === 'player' ? 'P1' : 'P2';
  const result = `${winner} 승리 · ${game.roundWins[0]} : ${game.roundWins[1]}`;
  hideArena();
  localReady = false; remoteReady = null; chosen = [null, null]; earlyInputs = [];
  startButton.textContent = '준비';
  required<HTMLElement>('#selection-description').textContent = `${result} · 캐릭터를 다시 선택하세요.`;
  menuScreen.hidden = true; selectionScreen.hidden = false; guide.hidden = false;
  renderChoice(0); renderChoice(1);
}

async function enterOnline(role: OnlineRole, token: string): Promise<void> {
  await stopConnection(); hideArena();
  mode = 'online'; onlineRole = role; onlineToken = token;
  if (role === 'host') sessionStorage.setItem('grim-host-token', token);
  else sessionStorage.removeItem('grim-host-token');
  localReady = false; remoteReady = null; pingMs = null;
  chosen = [null, null];
  location.hash = `duel=${token}`;
  required<HTMLElement>('#selection-heading').textContent = role === 'host' ? '온라인 대전 · P1' : '온라인 대전 · P2';
  required<HTMLElement>('#selection-description').textContent = '자신의 캐릭터를 고르고 연결 후 준비를 누르세요.';
  required<HTMLElement>('#player-title').textContent = role === 'host' ? 'P1 · 내 캐릭터' : 'P1 · 상대';
  required<HTMLElement>('#opponent-title').textContent = role === 'host' ? 'P2 · 상대' : 'P2 · 내 캐릭터';
  startButton.textContent = '준비';
  onlineLobby.hidden = false; inviteRow.hidden = role !== 'host';
  inviteField.value = role === 'host' ? inviteUrl(token) : '';
  countdownText.hidden = true; retryButton.hidden = true;
  menuScreen.hidden = true; selectionScreen.hidden = false; guide.hidden = false;
  const generation = ++connectionGeneration;
  try {
    connection = new P2PConnection(role, token, {
      state: (state, detail) => {
        if (generation !== connectionGeneration) return;
        setConnectionState(state, detail);
        if (state === 'connected' && chosen[0]) {
          connection?.sendControl({ kind: 'select', characterId: chosen[0].id, version });
          if (localReady) connection?.sendControl({ kind: 'ready', characterId: chosen[0].id, version });
        }
      },
      control: packet => { if (generation === connectionGeneration) receiveControl(packet); },
      input: packet => {
        if (generation !== connectionGeneration) return;
        if (match) match.receiveInput(packet);
        else if (countdown && earlyInputs.length < 300) earlyInputs.push(packet);
      },
      hash: packet => { if (generation === connectionGeneration) match?.receiveHash(packet); },
      snapshot: packet => { if (generation === connectionGeneration) match?.receiveSnapshot(packet); },
      ping: ms => { if (generation === connectionGeneration) { pingMs = ms; onlinePing.textContent = ms === null ? '핑 --' : `핑 ${ms}ms`; } }
    });
  } catch (error) { setConnectionState('error', error instanceof Error ? error.message : String(error)); }
  renderChoice(0); renderChoice(1);
}

required<HTMLButtonElement>('#local-mode').addEventListener('click', enterLocal);
window.addEventListener('resize', resizeGameCanvas);
required<HTMLButtonElement>('#online-mode').addEventListener('click', () => { void enterOnline('host', createInviteToken()); });
window.addEventListener('hashchange', () => {
  const token = tokenFromFragment(location.hash);
  if (token && (mode !== 'online' || token !== onlineToken)) void enterOnline('guest', token);
});
required<HTMLButtonElement>('#selection-back').addEventListener('click', enterMenu);
required<HTMLButtonElement>('#copy-link').addEventListener('click', () => {
  void navigator.clipboard.writeText(inviteField.value).then(() => {
    required<HTMLButtonElement>('#copy-link').textContent = '복사됨';
  }).catch(() => { inviteField.select(); document.execCommand('copy'); });
});
retryButton.addEventListener('click', () => { void enterOnline(onlineRole, onlineToken); });
required<HTMLButtonElement>('#disconnect-retry').addEventListener('click', () => { void enterOnline(onlineRole, onlineToken); });
required<HTMLButtonElement>('#disconnect-menu').addEventListener('click', enterMenu);
startButton.addEventListener('click', () => {
  if (mode === 'online') { setLocalReady(!localReady); return; }
  const player = chosen[0], dummy = chosen[1]; if (!player?.data || !dummy?.data) return;
  game = new Game(player.data, dummy.data);
  renderer = new Renderer(drawContext, player.atlas, dummy.atlas);
  showArena();
});
required<HTMLButtonElement>('#back-to-select').addEventListener('click', () => { if (mode === 'local') { hideArena(); enterLocal(); } });
required<HTMLButtonElement>('#restart').addEventListener('click', () => { if (mode === 'local') game?.restart(); });
function setDummyMode(dummyMode: DummyMode): void {
  if (mode !== 'local') return;
  game?.setMode(dummyMode);
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => item.classList.toggle('active', item.dataset.mode === dummyMode));
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => setDummyMode(button.dataset.mode as DummyMode)));
loadRoster().then(result => {
  entries = result.entries; version = rosterVersion(entries);
  renderIssues(result.issues);
  const token = tokenFromFragment(location.hash);
  if (token) void enterOnline(sessionStorage.getItem('grim-host-token') === token ? 'host' : 'guest', token);
  else enterMenu();
}).catch(error => {
  const message = `캐릭터 선택 화면: ${error instanceof Error ? error.message : String(error)}`;
  console.error(message); renderIssues([message]); enterMenu();
});

const timestep = 1000 / TICK_RATE;
const maxTicksPerFrame = 4;
let previous = performance.now();
let accumulator = 0;
function frame(now: number) {
  accumulator = Math.min(accumulator + Math.max(0, now - previous), timestep * maxTicksPerFrame);
  previous = now;
  while (accumulator >= timestep) {
    const snapshot = input.read();
    if (game && mode === 'local') game.update(snapshot);
    else if (match && connectionState === 'connected') match.capture(snapshot);
    previewTick++; accumulator -= timestep;
  }
  if (match && connectionState === 'connected') {
    match.advance(maxTicksPerFrame);
    if (game?.seriesWinner) finishOnlineSeries();
  }
  if (countdown) {
    const remaining = Math.max(0, Math.ceil((countdown.until - now) / 1000));
    countdownText.textContent = remaining ? `${remaining}초 후 시작` : '대전 시작';
    if (!remaining) startOnlineFight(countdown);
  }
  if (game && renderer) {
    const viewerSide: 0 | 1 = mode === 'online' && onlineRole === 'guest' ? 1 : 0;
    renderer.draw(game, mode === 'online' ? `P2P · ${pingMs === null ? '핑 --' : `${pingMs}ms`}` : '', viewerSide);
    status.textContent = game.winner ? `${game.winner === 'player' ? 'P1' : 'P2'} 승리` : `${game.player.state.toUpperCase()} · ${game.notice}`;
  } else { drawPreview(0); drawPreview(1); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
