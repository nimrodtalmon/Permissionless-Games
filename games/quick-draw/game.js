import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getWordForRound } from '../../lib/words.js';

const GAME_TYPE = 'quick-draw';
const DRAW_SECS = 60;
const DONE_SECS = 5;
const BASIC_COLORS = ['#1a1a1a', '#e74c3c', '#3498db'];

const player = getPlayer();
const roomId = getRoomId();

let round = null;
let allPlayers = [];
let cachedStrokes = {};
// Strokes drawn locally but not yet confirmed by Firebase — kept visible during network round-trip
let pendingLocalStrokes = {};
let isDrawing = false;
let currentStroke = [];
let strokeWidth = 3;
let penColor = '#1a1a1a';
let timerInterval = null;
let currentPhase = null;
let drawCanvas, drawCtx, liveCanvas, liveCtx;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initShareWidget('share-container');

  drawCanvas = document.getElementById('draw-canvas');
  drawCtx = drawCanvas.getContext('2d');
  liveCanvas = document.getElementById('live-canvas');
  liveCtx = liveCanvas.getContext('2d');

  setupCanvas();
  buildColorPalette();

  await sync.joinRoom(GAME_TYPE, roomId, player);

  sync.onPlayers(GAME_TYPE, roomId, players => {
    allPlayers = players.filter(p => p.online);
    renderPlayerList();
  });

  // All players share one strokes path — incremental render keeps it smooth
  sync.onState(GAME_TYPE, roomId, 'strokes', onStrokesUpdate);
  sync.onState(GAME_TYPE, roomId, 'round', onRoundUpdate);

  const existing = await sync.getState(GAME_TYPE, roomId, 'round');
  if (!existing) await startRound(0);

  window.addEventListener('beforeunload', () => sync.leaveRoom(GAME_TYPE, roomId, player.id));
}

// ─── Round management ─────────────────────────────────────────────────────────

async function startRound(n) {
  const current = await sync.getState(GAME_TYPE, roomId, 'round');
  if (current && current.roundNumber >= n) return;

  // Clear shared canvas before writing the new round
  await sync.setState(GAME_TYPE, roomId, 'strokes', null);
  const { word } = getWordForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'round', {
    word,
    startedAt: Date.now(),
    roundNumber: n,
  });
}

function onRoundUpdate(data) {
  if (!data) return;
  round = data;

  cachedStrokes = {};
  pendingLocalStrokes = {};
  isDrawing = false;
  currentStroke = [];
  clearCanvas();
  hideDoneOverlay();

  document.getElementById('round-number').textContent = `Round ${data.roundNumber + 1}`;

  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 250);
  tick();
}

function tick() {
  if (!round) return;
  const elapsed = (Date.now() - round.startedAt) / 1000;

  if (elapsed < DRAW_SECS) {
    if (currentPhase !== 'drawing') setPhase('drawing');
    const secs = Math.ceil(DRAW_SECS - elapsed);
    const timerEl = document.getElementById('draw-timer');
    timerEl.textContent = secs;
    timerEl.classList.toggle('urgent', secs <= 10);
  } else if (elapsed < DRAW_SECS + DONE_SECS) {
    if (currentPhase !== 'done') setPhase('done');
    document.getElementById('done-countdown').textContent =
      Math.ceil(DRAW_SECS + DONE_SECS - elapsed);
  } else {
    clearInterval(timerInterval);
    startRound(round.roundNumber + 1);
  }
}

function setPhase(phase) {
  currentPhase = phase;
  if (phase === 'drawing') {
    document.getElementById('word-text').textContent = round.word;
    document.getElementById('draw-timer').style.display = '';
    hideDoneOverlay();
  } else if (phase === 'done') {
    document.getElementById('draw-timer').style.display = 'none';
    showDoneOverlay();
  }
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function setupCanvas() {
  // All pointer events go to live-canvas (the top layer)
  liveCanvas.addEventListener('pointerdown', onPointerDown);
  liveCanvas.addEventListener('pointermove', onPointerMove);
  liveCanvas.addEventListener('pointerup', onPointerUp);
  liveCanvas.addEventListener('pointercancel', onPointerUp);
  liveCanvas.style.touchAction = 'none';

  document.getElementById('undo-btn').addEventListener('click', undoStroke);
  document.getElementById('clear-btn').addEventListener('click', clearMyStrokes);

  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      strokeWidth = Number(btn.dataset.size);
    });
  });

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const size = Math.min(wrap.clientWidth, Math.floor(window.innerHeight * 0.52));
  if (drawCanvas.width === size) return;
  drawCanvas.width = liveCanvas.width = size;
  drawCanvas.height = liveCanvas.height = size;
  renderAllStrokes();
}

function clearCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
}

function renderAllStrokes() {
  const all = { ...cachedStrokes, ...pendingLocalStrokes };
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  Object.values(all).forEach(s => s && drawStroke(drawCtx, s));
}

function onStrokesUpdate(strokes) {
  cachedStrokes = strokes || {};
  // Once Firebase confirms a pending stroke, remove it from pending
  Object.keys(pendingLocalStrokes).forEach(id => {
    if (cachedStrokes[id]) delete pendingLocalStrokes[id];
  });
  renderAllStrokes();
}

function drawStroke(ctx, stroke) {
  if (!stroke?.points || stroke.points.length < 2) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width * (w / 300));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [first, ...rest] = stroke.points;
  ctx.moveTo(first.x * w, first.y * h);
  rest.forEach(p => ctx.lineTo(p.x * w, p.y * h));
  ctx.stroke();
}

function getPos(e) {
  const rect = liveCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

function onPointerDown(e) {
  if (currentPhase !== 'drawing') return;
  e.preventDefault();
  isDrawing = true;
  liveCanvas.setPointerCapture(e.pointerId);
  currentStroke = [getPos(e)];
  liveCtx.beginPath();
  const p = currentStroke[0];
  liveCtx.moveTo(p.x * liveCanvas.width, p.y * liveCanvas.height);
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getPos(e);
  currentStroke.push(pos);
  liveCtx.lineTo(pos.x * liveCanvas.width, pos.y * liveCanvas.height);
  liveCtx.strokeStyle = penColor;
  liveCtx.lineWidth = Math.max(1, strokeWidth * (liveCanvas.width / 300));
  liveCtx.lineCap = 'round';
  liveCtx.lineJoin = 'round';
  liveCtx.stroke();
}

async function onPointerUp(e) {
  if (!isDrawing) return;
  isDrawing = false;
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  if (currentStroke.length < 2) { currentStroke = []; return; }

  const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const strokeData = { points: currentStroke, color: penColor, width: strokeWidth, playerId: player.id };

  // Optimistic: add to pending and re-render immediately so the stroke
  // stays visible while waiting for Firebase to confirm it
  pendingLocalStrokes[strokeId] = strokeData;
  renderAllStrokes();

  await sync.setState(GAME_TYPE, roomId, `strokes/${strokeId}`, strokeData);
  currentStroke = [];
}

async function undoStroke() {
  const myStrokes = Object.entries(cachedStrokes)
    .filter(([, s]) => s?.playerId === player.id)
    .sort(([a], [b]) => (a < b ? 1 : -1)); // stroke IDs are time-prefixed
  if (!myStrokes.length) return;

  const [lastId] = myStrokes[0];
  delete cachedStrokes[lastId];
  delete pendingLocalStrokes[lastId];
  renderAllStrokes();
  await sync.setState(GAME_TYPE, roomId, `strokes/${lastId}`, null);
}

async function clearMyStrokes() {
  const myIds = Object.entries(cachedStrokes)
    .filter(([, s]) => s?.playerId === player.id)
    .map(([id]) => id);
  if (!myIds.length) return;

  myIds.forEach(id => { delete cachedStrokes[id]; delete pendingLocalStrokes[id]; });
  renderAllStrokes();

  const updates = Object.fromEntries(myIds.map(id => [id, null]));
  await sync.updateState(GAME_TYPE, roomId, 'strokes', updates);
}

// ─── Color palette ────────────────────────────────────────────────────────────

function buildColorPalette() {
  const palette = document.getElementById('color-palette');

  BASIC_COLORS.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (color === penColor ? ' active' : '');
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => selectColor(color, btn));
    palette.appendChild(btn);
  });

  // Fine-grained color picker — the "sphere"
  const input = document.createElement('input');
  input.type = 'color';
  input.id = 'color-input';
  input.className = 'color-input';
  input.value = '#9b59b6';
  input.title = 'Custom color';
  input.addEventListener('input', () => selectColor(input.value, input));
  palette.appendChild(input);
}

function selectColor(color, sourceEl) {
  penColor = color;
  document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
  document.getElementById('color-input')?.classList.remove('active');
  sourceEl.classList.add('active');
}

// ─── Done overlay ─────────────────────────────────────────────────────────────

function showDoneOverlay() {
  document.getElementById('done-word').textContent = round.word;
  document.getElementById('done-overlay').classList.remove('hidden');
}

function hideDoneOverlay() {
  document.getElementById('done-overlay').classList.add('hidden');
}

// ─── Player list ──────────────────────────────────────────────────────────────

function renderPlayerList() {
  document.getElementById('player-list').innerHTML = allPlayers
    .map(p => `<span class="player-chip${p.id === player.id ? ' is-me' : ''}" style="background:${p.color}">${p.name}</span>`)
    .join('');
}

init();
