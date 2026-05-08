import { sync } from '../../lib/sync.js';
import { getPlayer } from '../../lib/player.js';
import { getRoomId } from '../../lib/room.js';
import { initShareWidget } from '../../lib/share.js';
import { getQuestionForRound } from '../../lib/questions.js';

const GAME_TYPE = 'trivia-race';
const ANSWER_SECS = 15;
const RESULT_SECS = 4;

const player = getPlayer();
const roomId = getRoomId();

let round = null;
let answers = {};
let scores = {};
let allPlayers = [];
let myAnswer = null;
let phase = null;
let ticker = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initShareWidget('share-container');

  document.getElementById('answers-grid').addEventListener('click', e => {
    const btn = e.target.closest('.answer-btn');
    if (btn && !btn.disabled) submitAnswer(Number(btn.dataset.index));
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

  sync.onState(GAME_TYPE, roomId, 'answers', data => {
    answers = data || {};
    renderAll();
  });

  sync.onState(GAME_TYPE, roomId, 'round', onRoundUpdate);

  const existing = await sync.getState(GAME_TYPE, roomId, 'round');
  if (!existing) await startRound(0);

  window.addEventListener('beforeunload', () => sync.leaveRoom(GAME_TYPE, roomId, player.id));
}

// ─── Round management ─────────────────────────────────────────────────────────

async function startRound(n) {
  const current = await sync.getState(GAME_TYPE, roomId, 'round');
  if (current && current.questionIndex >= n) return;

  const q = getQuestionForRound(roomId, n);
  await sync.setState(GAME_TYPE, roomId, 'answers', null);
  await sync.setState(GAME_TYPE, roomId, 'round', {
    question: q.q,
    options: q.options,
    correctIndex: q.correct,
    startedAt: Date.now(),
    questionIndex: n,
  });
}

function onRoundUpdate(data) {
  if (!data) return;
  round = data;
  myAnswer = null;
  phase = null;
  answers = {};
  clearInterval(ticker);
  ticker = setInterval(tick, 100);
  tick();
}

function tick() {
  if (!round) return;
  const elapsed = (Date.now() - round.startedAt) / 1000;

  if (elapsed < ANSWER_SECS) {
    if (phase !== 'answering') setPhase('answering');
    const remaining = ANSWER_SECS - elapsed;
    document.getElementById('q-timer').textContent = Math.ceil(remaining);
    document.getElementById('q-timer').classList.toggle('urgent', remaining < 5);
    const bar = document.getElementById('timer-bar');
    bar.style.width = (remaining / ANSWER_SECS * 100) + '%';
    bar.classList.toggle('urgent', remaining < 5);
  } else if (elapsed < ANSWER_SECS + RESULT_SECS) {
    if (phase !== 'results') setPhase('results');
    const remaining = ANSWER_SECS + RESULT_SECS - elapsed;
    document.getElementById('q-timer').textContent = Math.ceil(remaining);
    document.getElementById('timer-bar').style.width = '0%';
  } else {
    clearInterval(ticker);
    startRound(round.questionIndex + 1);
  }
}

function setPhase(p) {
  phase = p;
  renderAll();
}

// ─── Answering ────────────────────────────────────────────────────────────────

async function submitAnswer(optionIndex) {
  if (phase !== 'answering' || myAnswer !== null || !round) return;
  myAnswer = optionIndex;
  renderAll();

  await sync.setState(GAME_TYPE, roomId, `answers/${player.id}`, {
    optionIndex,
    answeredAt: Date.now(),
  });

  if (optionIndex === round.correctIndex) {
    await sync.updateState(GAME_TYPE, roomId, 'scores', { [player.id]: sync.increment(1) });
    if (navigator.vibrate) navigator.vibrate(15);
  } else {
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderAll() {
  if (!round) return;

  document.getElementById('question-text').textContent = round.question;
  document.getElementById('q-number').textContent = `Q ${round.questionIndex + 1}`;

  const inResults = phase === 'results';
  const answered = myAnswer !== null;

  document.querySelectorAll('.answer-btn').forEach((btn, i) => {
    btn.querySelector('.answer-text').textContent = round.options[i];
    btn.disabled = inResults || answered;

    if (inResults) {
      if (i === round.correctIndex) {
        btn.dataset.state = 'correct';
      } else if (i === myAnswer) {
        btn.dataset.state = 'wrong';
      } else {
        btn.dataset.state = 'dim';
      }
    } else if (answered) {
      btn.dataset.state = i === myAnswer ? 'selected' : 'dim';
    } else {
      btn.dataset.state = '';
    }
  });

  const resultEl = document.getElementById('result-info');
  if (inResults) {
    resultEl.classList.remove('hidden');
    const correct = Object.entries(answers)
      .filter(([, a]) => a.optionIndex === round.correctIndex)
      .sort(([, a], [, b]) => a.answeredAt - b.answeredAt);

    if (correct.length === 0) {
      resultEl.innerHTML = '😬 Nobody got it!';
    } else {
      const names = correct.slice(0, 3)
        .map(([pid]) => {
          const p = allPlayers.find(p => p.id === pid);
          return p ? `<span style="color:${p.color};font-weight:700">${p.name}</span>` : null;
        })
        .filter(Boolean)
        .join(', ');
      const more = correct.length > 3 ? ` +${correct.length - 3}` : '';
      resultEl.innerHTML = `✓ ${names}${more} got it!`;
    }
  } else {
    resultEl.classList.add('hidden');
  }
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
