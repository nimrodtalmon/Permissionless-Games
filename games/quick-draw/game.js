import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getWordForRound } from '../../lib/words.js';

const GAME_TYPE = 'quick-draw';
const DRAW_SECS = 60;
const GALLERY_SECS = 20;

const player = getPlayer();
const roomId = getRoomId();

const PALETTE = ['#1a1a1a', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ffffff', '#795548', '#607d8b'];

let round = null;
let allDrawings = {};   // { playerId: { strokeId: {points, color, width} } }
let allPlayers = [];
let strokeHistory = []; // own stroke IDs, for undo
let isDrawing = false;
let currentStroke = [];
let strokeWidth = 3;
let penColor = player.color; // starts as player's identity color
let timerInterval = null;
let currentPhase = null;
let drawCanvas, drawCtx;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initShareWidget('share-container');

  drawCanvas = document.getElementById('draw-canvas');
  drawCtx = drawCanvas.getContext('2d');
  setupCanvas();

  await sync.joinRoom(GAME_TYPE, roomId, player);

  sync.onPlayers(GAME_TYPE, roomId, players => {
    allPlayers = players.filter(p => p.online);
    renderPlayerLists();
  });

  sync.onState(GAME_TYPE, roomId, 'drawings', drawings => {
    allDrawings = drawings || {};
    if (currentPhase === 'drawing') refreshThumbnails();
    if (currentPhase === 'gallery') refreshGalleryCanvases();
  });

  sync.onState(GAME_TYPE, roomId, 'reactions', refreshReactions);

  sync.onState(GAME_TYPE, roomId, 'round', onRoundUpdate);

  const existing = await sync.getState(GAME_TYPE, roomId, 'round');
  if (!existing) await startRound(0);

  // Reaction clicks delegated to stable container
  document.getElementById('drawings-grid').addEventListener('click', onReactionClick);

  window.addEventListener('beforeunload', () => sync.leaveRoom(GAME_TYPE, roomId, player.id));
}

// ─── Round management ─────────────────────────────────────────────────────────

async function startRound(n) {
  const current = await sync.getState(GAME_TYPE, roomId, 'round');
  if (current && current.roundNumber >= n) return;

  // Clear previous round's drawings and reactions
  await sync.setState(GAME_TYPE, roomId, 'drawings', null);
  await sync.setState(GAME_TYPE, roomId, 'reactions', null);

  const { word, emoji } = getWordForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'round', {
    word,
    emoji,
    startedAt: Date.now(),
    roundNumber: n,
  });
}

function onRoundUpdate(data) {
  if (!data) return;
  round = data;
  strokeHistory = [];
  isDrawing = false;
  currentStroke = [];
  currentPhase = null; // force phase re-evaluation

  document.getElementById('round-number').textContent = `Round ${data.roundNumber + 1}`;

  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 500);
  tick();
}

function tick() {
  if (!round) return;
  const elapsed = (Date.now() - round.startedAt) / 1000;

  if (elapsed < DRAW_SECS) {
    setPhase('drawing');
    document.getElementById('draw-timer').textContent = Math.ceil(DRAW_SECS - elapsed);
  } else if (elapsed < DRAW_SECS + GALLERY_SECS) {
    setPhase('gallery');
    document.getElementById('gallery-timer').textContent = Math.ceil(DRAW_SECS + GALLERY_SECS - elapsed);
  } else {
    clearInterval(timerInterval);
    startRound(round.roundNumber + 1);
  }
}

function setPhase(phase) {
  if (phase === currentPhase) return;
  currentPhase = phase;

  document.getElementById('drawing-phase').classList.toggle('hidden', phase !== 'drawing');
  document.getElementById('gallery-phase').classList.toggle('hidden', phase !== 'gallery');

  if (phase === 'drawing') {
    document.getElementById('draw-word-emoji').textContent = round.emoji;
    document.getElementById('draw-word-text').textContent = round.word;
    resizeCanvas();
    refreshThumbnails();
    // Re-render own strokes (e.g. after resize or returning from gallery)
    renderStrokesOnCtx(drawCtx, allDrawings[player.id] || {}, drawCanvas.width, drawCanvas.height);
  } else if (phase === 'gallery') {
    document.getElementById('gallery-word-emoji').textContent = round.emoji;
    document.getElementById('gallery-word-text').textContent = round.word;
    buildGallery();
  }
}

// ─── Canvas setup & drawing ───────────────────────────────────────────────────

function setupCanvas() {
  drawCanvas.addEventListener('pointerdown', onPointerDown);
  drawCanvas.addEventListener('pointermove', onPointerMove);
  drawCanvas.addEventListener('pointerup', onPointerUp);
  drawCanvas.addEventListener('pointercancel', onPointerUp);
  drawCanvas.style.touchAction = 'none';

  document.getElementById('undo-btn').addEventListener('click', undoStroke);
  document.getElementById('clear-btn').addEventListener('click', clearDrawing);

  buildColorPalette();

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

function buildColorPalette() {
  const palette = document.getElementById('color-palette');
  // Player's own color first, then fixed palette
  const colors = [player.color, ...PALETTE];
  colors.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (color === penColor ? ' active' : '');
    btn.style.background = color;
    btn.title = color === player.color ? 'Your color' : color;
    btn.dataset.color = color;
    // White swatch needs a border to be visible
    if (color === '#ffffff') btn.style.border = '2px solid #ccc';
    btn.addEventListener('click', () => {
      penColor = color;
      palette.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    palette.appendChild(btn);
  });
}

function resizeCanvas() {
  const wrap = drawCanvas.parentElement;
  const size = Math.min(wrap.clientWidth, Math.floor(window.innerHeight * 0.48));
  if (drawCanvas.width === size) return;
  // Snapshot current drawing, resize, redraw
  const snapshot = allDrawings[player.id] || {};
  drawCanvas.width = size;
  drawCanvas.height = size;
  renderStrokesOnCtx(drawCtx, snapshot, size, size);
}

function getPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

function onPointerDown(e) {
  if (currentPhase !== 'drawing') return;
  e.preventDefault();
  isDrawing = true;
  drawCanvas.setPointerCapture(e.pointerId);
  currentStroke = [getPos(e)];
  drawCtx.beginPath();
  const p = currentStroke[0];
  drawCtx.moveTo(p.x * drawCanvas.width, p.y * drawCanvas.height);
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getPos(e);
  currentStroke.push(pos);
  drawCtx.lineTo(pos.x * drawCanvas.width, pos.y * drawCanvas.height);
  drawCtx.strokeStyle = penColor;
  drawCtx.lineWidth = strokeWidth;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.stroke();
}

async function onPointerUp(e) {
  if (!isDrawing) return;
  isDrawing = false;
  if (currentStroke.length < 2) { currentStroke = []; return; }

  const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  strokeHistory.push(strokeId);

  await sync.setState(GAME_TYPE, roomId, `drawings/${player.id}/${strokeId}`, {
    points: currentStroke,
    color: penColor,
    width: strokeWidth,
  });
  currentStroke = [];
}

async function undoStroke() {
  if (!strokeHistory.length) return;
  const lastId = strokeHistory.pop();
  await sync.setState(GAME_TYPE, roomId, `drawings/${player.id}/${lastId}`, null);
  const remaining = { ...(allDrawings[player.id] || {}) };
  delete remaining[lastId];
  renderStrokesOnCtx(drawCtx, remaining, drawCanvas.width, drawCanvas.height);
}

async function clearDrawing() {
  strokeHistory = [];
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  await sync.setState(GAME_TYPE, roomId, `drawings/${player.id}`, null);
}

// ─── Stroke rendering (shared by canvas, thumbnails, gallery) ────────────────

function renderStrokesOnCtx(ctx, strokes, w, h) {
  ctx.clearRect(0, 0, w, h);
  Object.values(strokes || {}).forEach(stroke => {
    if (!stroke?.points || stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.width * (w / 300));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [first, ...rest] = stroke.points;
    ctx.moveTo(first.x * w, first.y * h);
    rest.forEach(p => ctx.lineTo(p.x * w, p.y * h));
    ctx.stroke();
  });
}

// ─── Thumbnails (live previews during drawing) ────────────────────────────────

function refreshThumbnails() {
  const container = document.getElementById('thumbnails');
  const others = Object.entries(allDrawings).filter(([pid]) => pid !== player.id);

  if (!others.length) {
    container.innerHTML = '<span class="thumbnails-empty">No one else is drawing yet</span>';
    return;
  }

  // Reuse existing thumbnail canvases where possible
  const existing = new Map([...container.querySelectorAll('.thumb-wrap')].map(el => [el.dataset.pid, el]));

  others.forEach(([pid, strokes]) => {
    const p = allPlayers.find(pl => pl.id === pid);
    const name = p?.name ?? 'Player';
    const color = p?.color ?? '#999';

    let wrap = existing.get(pid);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
      wrap.dataset.pid = pid;
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 80;
      const label = document.createElement('span');
      label.className = 'thumb-label';
      wrap.appendChild(canvas);
      wrap.appendChild(label);
      container.appendChild(wrap);
    }

    const canvas = wrap.querySelector('canvas');
    const label = wrap.querySelector('.thumb-label');
    label.textContent = name;
    label.style.color = color;
    renderStrokesOnCtx(canvas.getContext('2d'), strokes, 80, 80);
    existing.delete(pid);
  });

  // Remove thumbnails for players who left / cleared
  existing.forEach(el => el.remove());
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

function buildGallery() {
  const grid = document.getElementById('drawings-grid');
  grid.innerHTML = '';

  const entries = Object.entries(allDrawings);
  if (!entries.length) {
    grid.innerHTML = '<p class="gallery-empty">No drawings this round!</p>';
    return;
  }

  entries.forEach(([pid, strokes]) => {
    const p = allPlayers.find(pl => pl.id === pid);
    const name = p?.name ?? 'Player';
    const color = p?.color ?? '#999';
    const isMe = pid === player.id;

    const card = document.createElement('div');
    card.className = `drawing-card${isMe ? ' is-mine' : ''}`;
    card.dataset.pid = pid;

    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 240;
    renderStrokesOnCtx(canvas.getContext('2d'), strokes, 240, 240);

    card.innerHTML = `
      <div class="drawing-canvas-slot"></div>
      <div class="drawing-artist">
        <span class="player-chip" style="background:${color}">${name}${isMe ? '<span class="player-score">you</span>' : ''}</span>
      </div>
      <div class="reaction-bar" data-pid="${pid}">
        ${['❤️', '😂', '🔥'].map(r =>
          `<button class="reaction-btn" data-pid="${pid}" data-r="${r}">${r}<span class="r-count" id="rc-${pid}-${r}">0</span></button>`
        ).join('')}
      </div>
    `;
    card.querySelector('.drawing-canvas-slot').appendChild(canvas);
    grid.appendChild(card);
  });
}

function refreshGalleryCanvases() {
  Object.entries(allDrawings).forEach(([pid, strokes]) => {
    const card = document.querySelector(`.drawing-card[data-pid="${pid}"]`);
    if (!card) return;
    const canvas = card.querySelector('canvas');
    if (canvas) renderStrokesOnCtx(canvas.getContext('2d'), strokes, 240, 240);
  });
}

async function onReactionClick(e) {
  const btn = e.target.closest('.reaction-btn');
  if (!btn) return;
  const { pid, r } = btn.dataset;
  // Toggle: clicking same reaction removes it
  const path = `reactions/${pid}/${player.id}`;
  const current = await sync.getState(GAME_TYPE, roomId, path);
  await sync.setState(GAME_TYPE, roomId, path, current === r ? null : r);
}

function refreshReactions(reactions) {
  // Reset
  document.querySelectorAll('.r-count').forEach(el => el.textContent = '0');
  document.querySelectorAll('.reaction-btn').forEach(btn => btn.classList.remove('reacted'));
  if (!reactions) return;

  Object.entries(reactions).forEach(([drawingPid, reactors]) => {
    const counts = {};
    Object.entries(reactors || {}).forEach(([rid, r]) => {
      counts[r] = (counts[r] || 0) + 1;
      if (rid === player.id) {
        const btn = document.querySelector(`.reaction-btn[data-pid="${drawingPid}"][data-r="${r}"]`);
        if (btn) btn.classList.add('reacted');
      }
    });
    Object.entries(counts).forEach(([r, n]) => {
      const el = document.getElementById(`rc-${drawingPid}-${r}`);
      if (el) el.textContent = n;
    });
  });
}

// ─── Player lists ─────────────────────────────────────────────────────────────

function renderPlayerLists() {
  const html = allPlayers
    .map(p => `<span class="player-chip${p.id === player.id ? ' is-me' : ''}" style="background:${p.color}">${p.name}</span>`)
    .join('');
  document.getElementById('player-list-draw').innerHTML = html;
  document.getElementById('player-list-gallery').innerHTML = html;
}

init();
