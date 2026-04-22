import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getWordForRound } from '../../lib/words.js';

const GAME_TYPE = 'drawing-guess';
const NEXT_ROUND_DELAY = 5000;

const player = getPlayer();
const roomId = getRoomId();
let puzzle = null;
let nextRoundTimer = null;
let currentPlayers = [];
let currentScores = {};

async function init() {
  initShareWidget('share-container');
  renderKeyboard();

  await sync.joinRoom(GAME_TYPE, roomId, player);

  sync.onPlayers(GAME_TYPE, roomId, players => {
    currentPlayers = players;
    renderPlayers();
  });

  sync.onState(GAME_TYPE, roomId, 'scores', scores => {
    currentScores = scores || {};
    renderPlayers();
  });

  sync.onState(GAME_TYPE, roomId, 'puzzle', onPuzzleUpdate);

  const existing = await sync.getState(GAME_TYPE, roomId, 'puzzle');
  if (!existing) await startRound(0);

  window.addEventListener('beforeunload', () => {
    sync.leaveRoom(GAME_TYPE, roomId, player.id);
  });
}

async function startRound(n) {
  const current = await sync.getState(GAME_TYPE, roomId, 'puzzle');
  if (current && current.roundNumber >= n) return;

  const { word, emoji } = getWordForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'puzzle', {
    word,
    emoji,
    guessedLetters: {},
    solvedAt: null,
    startedAt: Date.now(),
    roundNumber: n,
  });
}

function onPuzzleUpdate(data) {
  if (!data) return;
  puzzle = data;

  const guessedLetters = data.guessedLetters || {};
  const guessed = new Set(Object.keys(guessedLetters));

  // Any client detects the win and writes solvedAt — idempotent
  if (!data.solvedAt) {
    const uniqueLetters = [...new Set(data.word.split(''))];
    if (uniqueLetters.every(l => guessed.has(l))) {
      sync.updateState(GAME_TYPE, roomId, 'puzzle', { solvedAt: Date.now() });
    }
  }

  // Use elapsed time so late-joining players schedule correctly and never get stuck
  clearTimeout(nextRoundTimer);
  if (data.solvedAt) {
    const remaining = Math.max(0, NEXT_ROUND_DELAY - (Date.now() - data.solvedAt));
    nextRoundTimer = setTimeout(() => startRound(data.roundNumber + 1), remaining);
  }

  renderAll(data, guessedLetters, guessed);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderAll(data, guessedLetters, guessed) {
  document.getElementById('clue-emoji').textContent = data.emoji;
  document.getElementById('round-number').textContent = `Round ${data.roundNumber + 1}`;
  renderBlanks(data.word, guessedLetters);
  renderStatus(data);
  refreshKeyboard(data.word, guessed, !!data.solvedAt);
}

function renderBlanks(word, guessedLetters) {
  document.getElementById('word-blanks').innerHTML = word
    .split('')
    .map(l => {
      const g = guessedLetters[l];
      if (g) {
        // Letter shows in the guesser's color; tooltip shows who guessed it
        return `<span class="blank revealed" style="--gc:${g.color}" title="${g.name}">${l}</span>`;
      }
      return `<span class="blank"></span>`;
    })
    .join('');
}

function renderStatus(data) {
  const el = document.getElementById('game-status');
  if (data.solvedAt) {
    el.textContent = `🎉 "${data.word}" — next puzzle soon…`;
    el.className = 'game-status win';
  } else {
    el.textContent = '';
    el.className = 'game-status';
  }
}

function renderPlayers() {
  document.getElementById('player-list').innerHTML = currentPlayers
    .filter(p => p.online)
    .map(p => {
      const score = currentScores[p.id] || 0;
      return `<span class="player-chip${p.id === player.id ? ' is-me' : ''}" style="background:${p.color}">${p.name}<span class="player-score">${score}</span></span>`;
    })
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
  if (!puzzle || puzzle.solvedAt) return;
  const guessed = new Set(Object.keys(puzzle.guessedLetters || {}));
  if (guessed.has(letter)) return;

  const isCorrect = puzzle.word.includes(letter);

  await sync.updateState(GAME_TYPE, roomId, 'puzzle', {
    [`guessedLetters/${letter}`]: { id: player.id, name: player.name, color: player.color },
  });

  if (isCorrect) {
    await sync.updateState(GAME_TYPE, roomId, 'scores', { [player.id]: sync.increment(1) });
    if (navigator.vibrate) navigator.vibrate(15);
  } else {
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
  }
}

// Physical keyboard
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const l = e.key.toUpperCase();
  if (/^[A-Z]$/.test(l)) {
    const btn = document.querySelector(`.key[data-letter="${l}"]`);
    if (btn && !btn.disabled) guessLetter(l);
  }
});

init();
