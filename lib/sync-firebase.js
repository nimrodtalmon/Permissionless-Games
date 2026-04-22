import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getDatabase, ref, set, get, update, onValue, off,
  serverTimestamp, onDisconnect, increment,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(app);

function roomRef(gameType, roomId, ...segments) {
  const path = ['rooms', gameType, roomId, ...segments].filter(Boolean).join('/');
  return ref(db, path);
}

export const sync = {
  async joinRoom(gameType, roomId, player) {
    const pRef = roomRef(gameType, roomId, 'players', player.id);
    await set(pRef, {
      name: player.name,
      color: player.color,
      lastSeen: Date.now(),
      online: true,
    });
    // Mark offline automatically when browser closes/disconnects
    onDisconnect(pRef).update({ online: false, lastSeen: Date.now() });
    await update(roomRef(gameType, roomId, 'meta'), {
      gameType,
      lastActivity: serverTimestamp(),
    });
  },

  async leaveRoom(gameType, roomId, playerId) {
    await update(roomRef(gameType, roomId, 'players', playerId), {
      online: false,
      lastSeen: Date.now(),
    });
  },

  async setState(gameType, roomId, path, value) {
    await set(roomRef(gameType, roomId, path), value);
    await update(roomRef(gameType, roomId, 'meta'), { lastActivity: serverTimestamp() });
  },

  async updateState(gameType, roomId, path, updates) {
    await update(roomRef(gameType, roomId, path), updates);
    await update(roomRef(gameType, roomId, 'meta'), { lastActivity: serverTimestamp() });
  },

  async getState(gameType, roomId, path) {
    const snap = await get(roomRef(gameType, roomId, path));
    return snap.val();
  },

  onState(gameType, roomId, path, callback) {
    const r = roomRef(gameType, roomId, path);
    onValue(r, snap => callback(snap.val()));
    return () => off(r);
  },

  onPlayers(gameType, roomId, callback) {
    const r = roomRef(gameType, roomId, 'players');
    onValue(r, snap => {
      const data = snap.val() || {};
      callback(Object.entries(data).map(([id, p]) => ({ id, ...p })));
    });
    return () => off(r);
  },

  // Expose Firebase's atomic increment so games don't import Firebase directly
  increment,
};
