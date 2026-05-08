export const SEED_WORDS = [
  'FIRE', 'OCEAN', 'NIGHT', 'SUN', 'MOON',
  'LOVE', 'FEAR', 'DREAM', 'GOLD', 'SNOW',
  'KING', 'MUSIC', 'STORM', 'DOOR', 'BOOK',
  'WOLF', 'APPLE', 'CLOUD', 'CITY', 'TIME',
  'BIRD', 'SALT', 'HOME', 'WAR', 'PEACE',
  'CAVE', 'LIGHT', 'DARK', 'TREE', 'ROSE',
  'SHIP', 'SAND', 'CLOCK', 'KEY', 'MAP',
  'SWORD', 'HONEY', 'RIVER', 'WIND', 'CAT',
  'DOG', 'STAR', 'RAIN', 'MAGIC', 'POWER',
  'SMILE', 'CAKE', 'SCHOOL', 'GAME', 'MASK',
  'LION', 'GHOST', 'GIANT', 'CROWN', 'BELL',
  'STONE', 'GLASS', 'WHEEL', 'CHAIN', 'FLAG',
  'BRIDGE', 'TOWER', 'CAGE', 'SHADOW', 'MIRROR',
  'SUMMER', 'WINTER', 'ISLAND', 'DESERT', 'COFFEE',
  'PAPER', 'NEEDLE', 'HAMMER', 'SPIDER', 'EAGLE',
  'DRAGON', 'PIRATE', 'WIZARD', 'ROBOT', 'JUNGLE',
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

const shuffleCache = new Map();

export function getSeedWordForRound(roomId, roundNumber) {
  if (!shuffleCache.has(roomId)) {
    const arr = [...SEED_WORDS];
    const rand = seededRandom(Math.abs(hashCode(roomId)));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    shuffleCache.set(roomId, arr);
  }
  return shuffleCache.get(roomId)[roundNumber % SEED_WORDS.length];
}
