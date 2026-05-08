import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getSeedWordForRound } from '../../lib/seed-words.js';

const GAME_TYPE = 'mind-meld';
const THINK_SECS = 12;
const REVEAL_SECS = 5;

// Match colors for groups of 2+ matching answers
const MATCH_COLORS = ['#16a34a', '#9333ea', '#ea580c', '#0284c7', '#be185d', '#b45309'];

const player = getPlayer();
const roomId = getRoomId();

let round = null;
let entries = {};
let scores = {};
let allPlayers = [];
let phase = null;
let ticker = null;
let submitted = false;
let scoredThisRound = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initShareWidget('share-container');

  const input = document.getElementById('answer-input');
  const submitBtn = document.getElementById('submit-btn');

  submitBtn.addEventListener('click', () => submitAnswer());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });

  await sync.joinRoom(GAME_TYPE, roomId, player);

  sync.onPlayers(GAME_TYPE, roomId, players => {
    allPlayers = players.filter(p => p.online);
    renderPlayerList();
  });

  sync.onState(GAME_TYPE, roomId, 'scores', data => {
    scores = data || {};
    renderPlayerList();
  });

  sync.onState(GAME_TYPE, roomId, 'entries', data => {
    entries = data || {};
    if (phase === 'thinking') renderThinkingStatus();
    if (phase === 'reveal') renderReveal();
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

  const word = getSeedWordForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'entries', null);
  await sync.setState(GAME_TYPE, roomId, 'round', {
    word,
    startedAt: Date.now(),
    roundNumber: n,
  });
}

function onRoundUpdate(data) {
  if (!data) return;
  round = data;
  entries = {};
  submitted = false;
  scoredThisRound = false;
  phase = null;

  document.getElementById('seed-word').textContent = data.word;
  document.getElementById('round-number').textContent = `Round ${data.roundNumber + 1}`;
  document.getElementById('answer-input').value = '';

  clearInterval(ticker);
  ticker = setInterval(tick, 100);
  tick();
}

function tick() {
  if (!round) return;
  const elapsed = (Date.now() - round.startedAt) / 1000;

  if (elapsed < THINK_SECS) {
    if (phase !== 'thinking') setPhase('thinking');
    const remaining = THINK_SECS - elapsed;
    document.getElementById('mm-timer').textContent = Math.ceil(remaining);
    document.getElementById('mm-timer').classList.toggle('urgent', remaining < 5);
    const bar = document.getElementById('timer-bar');
    bar.style.width = (remaining / THINK_SECS * 100) + '%';
    bar.classList.toggle('urgent', remaining < 5);
  } else if (elapsed < THINK_SECS + REVEAL_SECS) {
    if (phase !== 'reveal') setPhase('reveal');
    const remaining = THINK_SECS + REVEAL_SECS - elapsed;
    document.getElementById('mm-timer').textContent = Math.ceil(remaining);
    document.getElementById('timer-bar').style.width = '0%';
  } else {
    clearInterval(ticker);
    startRound(round.roundNumber + 1);
  }
}

function setPhase(p) {
  phase = p;
  if (p === 'thinking') {
    document.getElementById('input-section').classList.remove('hidden');
    document.getElementById('reveal-section').classList.add('hidden');
    renderThinkingStatus();
    if (!submitted) {
      const input = document.getElementById('answer-input');
      input.disabled = false;
      input.focus();
    }
  } else if (p === 'reveal') {
    document.getElementById('input-section').classList.add('hidden');
    document.getElementById('reveal-section').classList.remove('hidden');
    renderReveal();
    checkAndScore();
  }
}

// ─── Submitting ───────────────────────────────────────────────────────────────

async function submitAnswer() {
  if (submitted || phase !== 'thinking') return;
  const raw = document.getElementById('answer-input').value.trim();
  if (!raw) return;

  submitted = true;
  document.getElementById('answer-input').disabled = true;
  document.getElementById('submit-btn').disabled = true;
  renderThinkingStatus();

  await sync.setState(GAME_TYPE, roomId, `entries/${player.id}`, {
    word: raw.toUpperCase(),
    submittedAt: Date.now(),
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return str.trim().toLowerCase();
}

function checkAndScore() {
  if (scoredThisRound) return;
  const mine = entries[player.id];
  if (!mine) return;

  const myNorm = normalize(mine.word);
  const matched = Object.entries(entries)
    .some(([pid, e]) => pid !== player.id && normalize(e.word) === myNorm);

  if (matched) {
    scoredThisRound = true;
    sync.updateState(GAME_TYPE, roomId, 'scores', { [player.id]: sync.increment(1) });
    if (navigator.vibrate) navigator.vibrate([15, 50, 15]);
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderThinkingStatus() {
  const count = Object.keys(entries).length;
  const status = document.getElementById('input-status');
  if (submitted) {
    const others = count - (entries[player.id] ? 1 : 0);
    status.textContent = others > 0
      ? `✓ Locked in — ${others} other${others !== 1 ? 's' : ''} submitted`
      : '✓ Locked in — waiting for others…';
  } else {
    status.textContent = count > 0
      ? `${count} player${count !== 1 ? 's' : ''} locked in`
      : '';
  }
}

function renderReveal() {
  checkAndScore();

  // Build match groups (word → list of playerIds)
  const groups = {};
  Object.entries(entries).forEach(([pid, e]) => {
    const key = normalize(e.word);
    if (!groups[key]) groups[key] = [];
    groups[key].push(pid);
  });

  // Assign a highlight color to groups of 2+
  const groupColor = {};
  let colorIdx = 0;
  Object.entries(groups).forEach(([word, pids]) => {
    if (pids.length >= 2) {
      groupColor[word] = MATCH_COLORS[colorIdx++ % MATCH_COLORS.length];
    }
  });

  // Render cards, sorted: matched first, then alphabetical
  const sorted = Object.entries(entries).sort(([, a], [, b]) => {
    const aMatch = !!groupColor[normalize(a.word)];
    const bMatch = !!groupColor[normalize(b.word)];
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return a.word.localeCompare(b.word);
  });

  const list = document.getElementById('entries-list');
  list.innerHTML = '';
  sorted.forEach(([pid, entry], i) => {
    const p = allPlayers.find(p => p.id === pid) || { name: '?', color: '#888' };
    const color = groupColor[normalize(entry.word)];
    const isMe = pid === player.id;

    const card = document.createElement('div');
    card.className = 'entry-card' + (color ? ' matched' : '');
    card.style.animationDelay = `${i * 80}ms`;
    if (color) card.style.setProperty('--match-color', color);

    card.innerHTML = `
      <span class="entry-player" style="background:${p.color}">${p.name}${isMe ? ' (you)' : ''}</span>
      <span class="entry-word">${entry.word}</span>
      ${color ? '<span class="match-badge">✓</span>' : ''}
    `;
    list.appendChild(card);
  });

  // Show unsubmitted online players as blank cards
  allPlayers
    .filter(p => !entries[p.id])
    .forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'entry-card no-answer';
      card.style.animationDelay = `${(sorted.length + i) * 80}ms`;
      card.innerHTML = `
        <span class="entry-player" style="background:${p.color}">${p.name}${p.id === player.id ? ' (you)' : ''}</span>
        <span class="entry-word muted">—</span>
      `;
      list.appendChild(card);
    });
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
