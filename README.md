# Permissionless Games

A library of multiplayer games where anyone can join, leave, or go idle — the game always keeps going. No accounts, no waiting rooms.

**Live demo:** _deploy to GitHub Pages (see below)_

---

## Games

| Game | Description |
|------|-------------|
| 🎨 Drawing Guess | An emoji hides a secret word. Guess the letters before running out of chances. Anyone can join mid-round. |

---

## Setup

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project.
2. In the project, click **Build → Realtime Database** and create a database (start in test mode for now).
3. Go to **Project Settings → Your apps**, add a **Web app**, and copy the config object.

### 2. Add your Firebase config

Edit `lib/firebase-config.js` and paste your config values:

```js
export const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

### 3. Apply Firebase security rules

In the Firebase console under **Realtime Database → Rules**, paste the contents of `database.rules.json`, then publish.

### 4. Deploy to GitHub Pages

1. In your repo settings, go to **Pages** and set the source to **GitHub Actions**.
2. Push to `main` — the workflow in `.github/workflows/deploy.yml` deploys automatically.

Or run locally by serving the repo root with any static file server:

```sh
npx serve .
# or
python3 -m http.server 8080
```

---

## Architecture

```
lib/
  sync.js           ← swap backends by changing one import here
  sync-firebase.js  ← Firebase Realtime DB implementation
  firebase-config.js
  player.js         ← ephemeral identity (localStorage, no login)
  room.js           ← room ID from URL (?room=abc123)
  share.js          ← QR code + copy-link widget
  base.css / components.css

games/
  drawing-guess/
    index.html
    game.js
    style.css
    words.js
```

### Permissionless model

- **No auth** — random animal name + color assigned on first visit, stored in localStorage.
- **No host** — any client can advance the round; writes are idempotent via deterministic word selection.
- **Presence** — Firebase `onDisconnect` marks players offline automatically.
- **Sync abstraction** — all games import from `lib/sync.js`; swapping Firebase for Supabase/PartyKit requires changing one line.

### Adding a new game

1. Create `games/<your-game>/index.html`, `game.js`, `style.css`.
2. Import `sync`, `getPlayer`, `getRoomId`, `initShareWidget` from `../../lib/`.
3. Add an entry to the `GAMES` array in `index.html`.
