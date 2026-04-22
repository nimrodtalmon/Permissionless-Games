import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getWordForRound } from './words.js';

const GAME_TYPE = 'drawing-guess';
const MAX_WRONG = 6;
const NEXT_ROUND_DELAY = 5000;

// Face progresses as wrong guesses mount
const FACES = ['😊', '🙂', '😐', '😟', '😰', '😱', '💀'];

const player = getPlayer();
const roomId = getRoomId();
let puzzle = null;
let nextRoundTimer = null;

async function init() {
  initShareWidget('share-container');
  renderKeyboard();

  await sync.joinRoom(GAME_TYPE, roomId, player);
  sync.onPlayers(GAME_TYPE, roomId, renderPlayers);
  sync.onState(GAME_TYPE, roomId, 'puzzle', onPuzzleUpdate);

  // First player to load seeds the first puzzle
  const existing = await sync.getState(GAME_TYPE, roomId, 'puzzle');
  if (!existing) await startRound(0);

  window.addEventListener('beforeunload', () => {
    sync.leaveRoom(GAME_TYPE, roomId, player.id);
  });
}

async function startRound(n) {
  // Guard: don't overwrite a round that's already started or further along
  const current = await sync.getState(GAME_TYPE, roomId, 'puzzle');
  if (current && current.roundNumber >= n) return;

  const { word, emoji } = getWordForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'puzzle', {
    word,
    emoji,
    guessedLetters: {},
    wrongGuesses: 0,
    solvedAt: null,
    lostAt: null,
    startedAt: Date.now(),
    roundNumber: n,
  });
}

function onPuzzleUpdate(data) {
  if (!data) return;
  puzzle = data;

  const guessed = new Set(Object.keys(data.guessedLetters || {}));
  const wrongCount = data.wrongGuesses || 0;

  // Any client can detect and write the win/lose condition — idempotent writes
  if (!data.solvedAt && !data.lostAt) {
    const uniqueLetters = [...new Set(data.word.split(''))];
    if (uniqueLetters.every(l => guessed.has(l))) {
      sync.updateState(GAME_TYPE, roomId, 'puzzle', { solvedAt: Date.now() });
    } else if (wrongCount >= MAX_WRONG) {
      sync.updateState(GAME_TYPE, roomId, 'puzzle', { lostAt: Date.now() });
    }
  }

  // All online clients schedule the next round; startRound's guard makes it idempotent
  clearTimeout(nextRoundTimer);
  if (data.solvedAt || data.lostAt) {
    nextRoundTimer = setTimeout(() => startRound(data.roundNumber + 1), NEXT_ROUND_DELAY);
  }

  renderAll(data, guessed, wrongCount);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderAll(data, guessed, wrongCount) {
  document.getElementById('clue-emoji').textContent = data.emoji;
  renderBlanks(data.word, guessed);
  renderHangman(wrongCount, data.solvedAt);
  renderStatus(data);
  refreshKeyboard(data.word, guessed, data.solvedAt || data.lostAt);
}

function renderBlanks(word, guessed) {
  document.getElementById('word-blanks').innerHTML = word
    .split('')
    .map(l => `<span class="blank${guessed.has(l) ? ' revealed' : ''}">${guessed.has(l) ? l : ''}</span>`)
    .join('');
}

function renderHangman(wrongCount, solvedAt) {
  const face = solvedAt ? '🎉' : FACES[Math.min(wrongCount, FACES.length - 1)];
  document.getElementById('hangman-face').textContent = face;

  const countEl = document.getElementById('wrong-count');
  countEl.textContent = `${Math.min(wrongCount, MAX_WRONG)} / ${MAX_WRONG}`;
  const pct = wrongCount / MAX_WRONG;
  countEl.style.color = pct >= 1 ? 'var(--color-danger)' : pct >= 0.5 ? 'var(--color-warning)' : 'var(--color-text-muted)';
}

function renderStatus(data) {
  const el = document.getElementById('game-status');
  if (data.solvedAt) {
    el.textContent = `🎉 "${data.word}" — next puzzle in a moment…`;
    el.className = 'game-status win';
  } else if (data.lostAt) {
    el.textContent = `💀 The word was "${data.word}" — next puzzle in a moment…`;
    el.className = 'game-status lose';
  } else {
    el.textContent = '';
    el.className = 'game-status';
  }
}

function renderPlayers(players) {
  document.getElementById('player-list').innerHTML = players
    .filter(p => p.online)
    .map(p => `<span class="player-chip${p.id === player.id ? ' is-me' : ''}" style="background:${p.color}">${p.name}</span>`)
    .join('');
}

function renderKeyboard() {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const kb = document.getElementById('keyboard');
  kb.innerHTML = rows
    .map(row => `<div class="key-row">${row.split('').map(l => `<button class="key" data-letter="${l}">${l}</button>`).join('')}</div>`)
    .join('');

  kb.addEventListener('click', e => {
    if (e.target.classList.contains('key') && !e.target.disabled) {
      guessLetter(e.target.dataset.letter);
    }
  });
}

function refreshKeyboard(word, guessed, gameOver) {
  document.querySelectorAll('.key').forEach(key => {
    const l = key.dataset.letter;
    key.disabled = gameOver || guessed.has(l);
    key.classList.remove('correct', 'wrong');
    if (guessed.has(l)) key.classList.add(word.includes(l) ? 'correct' : 'wrong');
  });
}

// ─── Guessing ────────────────────────────────────────────────────────────────

async function guessLetter(letter) {
  if (!puzzle || puzzle.solvedAt || puzzle.lostAt) return;
  const guessed = new Set(Object.keys(puzzle.guessedLetters || {}));
  if (guessed.has(letter)) return;

  const updates = { [`guessedLetters/${letter}`]: true };
  // Firebase's atomic server-side increment avoids double-counting concurrent guesses
  if (!puzzle.word.includes(letter)) updates.wrongGuesses = sync.increment(1);

  await sync.updateState(GAME_TYPE, roomId, 'puzzle', updates);
}

// Physical keyboard support
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const l = e.key.toUpperCase();
  if (/^[A-Z]$/.test(l)) {
    const btn = document.querySelector(`.key[data-letter="${l}"]`);
    if (btn && !btn.disabled) guessLetter(l);
  }
});

init();
