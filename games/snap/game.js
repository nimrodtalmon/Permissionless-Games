import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';

const GAME_TYPE = 'snap';
const SIGNAL_WINDOW = 3000; // ms the GO signal is shown before results
const SHOW_RESULTS  = 4000; // ms results are shown before next round

const player = getPlayer();
const roomId  = getRoomId();

let round  = null;  // { roundNumber, startedAt, signalAt }
let taps   = {};    // { playerId: { tappedAt } }
let scores = {};
let allPlayers = [];
let phase  = null;
let ticker = null;
let tapped = false;
let scoredThisRound = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initShareWidget('share-container');

  const area = document.getElementById('tap-area');
  area.addEventListener('pointerdown', onTap);
  area.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onTap(); }
  });

  await sync.joinRoom(GAME_TYPE, roomId, player);

  sync.onPlayers(GAME_TYPE, roomId, players => {
    allPlayers = players.filter(p => p.online);
    renderPlayerList();
  });

  sync.onState(GAME_TYPE, roomId, 'scores', data => {
    scores = data || {};
    renderPlayerList();
  });

  sync.onState(GAME_TYPE, roomId, 'taps', data => {
    taps = data || {};
    if (phase === 'results') renderResults();
  });

  sync.onState(GAME_TYPE, roomId, 'round', onRoundUpdate);

  const existing = await sync.getState(GAME_TYPE, roomId, 'round');
  if (!existing) await startRound(0);

  window.addEventListener('beforeunload', () => sync.leaveRoom(GAME_TYPE, roomId, player.id));
}

// ─── Round management ─────────────────────────────────────────────────────────

async function startRound(n) {
  const current = await sync.getState(GAME_TYPE, roomId, 'round');
  if (current && current.roundNumber >= n) return;

  const now   = Date.now();
  const delay = 2000 + Math.random() * 3500; // 2–5.5 s random wait
  await sync.setState(GAME_TYPE, roomId, 'taps', null);
  await sync.setState(GAME_TYPE, roomId, 'round', {
    roundNumber: n,
    startedAt:   now,
    signalAt:    now + delay,
  });
}

function onRoundUpdate(data) {
  if (!data) return;
  round  = data;
  taps   = {};
  tapped = false;
  scoredThisRound = false;
  phase  = null;

  document.getElementById('round-number').textContent = `Round ${data.roundNumber + 1}`;

  // Reset display
  showPanel('tap');
  setTapDisplay('', 'Get ready…', 'Tap when the signal appears');

  clearInterval(ticker);
  ticker = setInterval(tick, 50);
  tick();
}

function tick() {
  if (!round) return;
  const now = Date.now();

  if (now < round.signalAt) {
    if (phase !== 'ready') setPhase('ready');
  } else if (now < round.signalAt + SIGNAL_WINDOW) {
    if (phase !== 'signal') setPhase('signal');
  } else if (now < round.signalAt + SIGNAL_WINDOW + SHOW_RESULTS) {
    if (phase !== 'results') setPhase('results');
  } else {
    clearInterval(ticker);
    startRound(round.roundNumber + 1);
  }
}

function setPhase(p) {
  phase = p;
  document.getElementById('tap-area').dataset.phase = tapped ? phase : p;

  if (p === 'ready') {
    showPanel('tap');
    setTapDisplay('', 'Get ready…', 'Tap when the signal appears');
  } else if (p === 'signal') {
    if (!tapped) {
      showPanel('tap');
      setTapDisplay('⚡', 'TAP!', '');
      document.getElementById('tap-area').dataset.phase = 'signal';
    }
    if (navigator.vibrate) navigator.vibrate(40);
  } else if (p === 'results') {
    checkAndScore();
    showPanel('results');
    renderResults();
  }
}

// ─── Tap handler ──────────────────────────────────────────────────────────────

async function onTap() {
  if (tapped || phase === 'results' || !round) return;
  tapped = true;

  const now = Date.now();
  const isFalseStart = now < round.signalAt;
  const area = document.getElementById('tap-area');

  if (isFalseStart) {
    area.dataset.phase = 'false-start';
    setTapDisplay('🚫', 'Too early!', '');
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
  } else {
    const ms = now - round.signalAt;
    area.dataset.phase = 'tapped';
    setTapDisplay('⚡', `${ms}ms`, ratingLabel(ms));
    if (navigator.vibrate) navigator.vibrate(15);
  }

  await sync.setState(GAME_TYPE, roomId, `taps/${player.id}`, { tappedAt: now });
}

function ratingLabel(ms) {
  if (ms < 180) return '🏆 Superhuman!';
  if (ms < 250) return '🔥 Lightning fast!';
  if (ms < 350) return '⚡ Nice!';
  if (ms < 500) return '👍 Good';
  return '🐢 Keep practicing…';
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function checkAndScore() {
  if (scoredThisRound) return;
  scoredThisRound = true;

  const valid = Object.entries(taps)
    .filter(([, t]) => t.tappedAt >= round.signalAt)
    .sort(([, a], [, b]) => a.tappedAt - b.tappedAt);

  const myRank = valid.findIndex(([pid]) => pid === player.id);
  if (myRank < 0) return;
  const pts = [3, 2, 1][myRank] ?? 0;
  if (pts > 0) sync.updateState(GAME_TYPE, roomId, 'scores', { [player.id]: sync.increment(pts) });
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderResults() {
  const valid = Object.entries(taps)
    .filter(([, t]) => t.tappedAt >= round.signalAt)
    .sort(([, a], [, b]) => a.tappedAt - b.tappedAt);

  const early = Object.entries(taps)
    .filter(([, t]) => t.tappedAt < round.signalAt);

  const tappedIds = new Set([...valid, ...early].map(([pid]) => pid));
  const missed = allPlayers.filter(p => !tappedIds.has(p.id));

  const medals = ['🥇', '🥈', '🥉'];
  const list = document.getElementById('results-list');
  list.innerHTML = '';

  valid.forEach(([pid, t], i) => {
    const p = allPlayers.find(p => p.id === pid) || { name: '?', color: '#888' };
    const ms = t.tappedAt - round.signalAt;
    const pts = ['+3', '+2', '+1'][i] || '';
    list.appendChild(makeRow(
      medals[i] || `${i + 1}`,
      p, `${ms}ms`, pts, pid === player.id
    ));
  });

  early.forEach(([pid]) => {
    const p = allPlayers.find(p => p.id === pid) || { name: '?', color: '#888' };
    list.appendChild(makeRow('🚫', p, 'too early', '', pid === player.id, 'early'));
  });

  missed.forEach(p => {
    list.appendChild(makeRow('—', p, 'missed', '', p.id === player.id, 'missed'));
  });
}

function makeRow(medal, p, time, pts, isMe, extraClass = '') {
  const row = document.createElement('div');
  row.className = `result-row ${extraClass} ${isMe ? 'is-me' : ''}`.trim();
  row.innerHTML = `
    <span class="result-medal">${medal}</span>
    <span class="result-name" style="color:${p.color}">${p.name}</span>
    <span class="result-time">${time}</span>
    ${pts ? `<span class="result-pts">${pts}</span>` : '<span></span>'}
  `;
  return row;
}

function showPanel(which) {
  document.getElementById('tap-content').classList.toggle('hidden', which !== 'tap');
  document.getElementById('results-content').classList.toggle('hidden', which !== 'results');
}

function setTapDisplay(emoji, label, sub) {
  document.getElementById('tap-emoji').textContent = emoji;
  document.getElementById('tap-label').textContent = label;
  document.getElementById('tap-sub').textContent = sub;
}

function renderPlayerList() {
  document.getElementById('player-list').innerHTML = allPlayers
    .map(p => {
      const score = scores[p.id] || 0;
      return `<span class="player-chip${p.id === player.id ? ' is-me' : ''}" style="background:${p.color}">${p.name}<span class="player-score">${score}</span></span>`;
    })
    .join('');
}

init();
