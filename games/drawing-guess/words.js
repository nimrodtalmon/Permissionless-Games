export const WORDS = [
  { word: 'ELEPHANT', emoji: '🐘' },
  { word: 'GUITAR', emoji: '🎸' },
  { word: 'VOLCANO', emoji: '🌋' },
  { word: 'UMBRELLA', emoji: '☂️' },
  { word: 'PENGUIN', emoji: '🐧' },
  { word: 'RAINBOW', emoji: '🌈' },
  { word: 'CASTLE', emoji: '🏰' },
  { word: 'ANCHOR', emoji: '⚓' },
  { word: 'CACTUS', emoji: '🌵' },
  { word: 'DRAGON', emoji: '🐉' },
  { word: 'TORNADO', emoji: '🌪️' },
  { word: 'COMPASS', emoji: '🧭' },
  { word: 'DOLPHIN', emoji: '🐬' },
  { word: 'PYRAMID', emoji: '🔺' },
  { word: 'COOKIE', emoji: '🍪' },
  { word: 'ROCKET', emoji: '🚀' },
  { word: 'TREASURE', emoji: '💰' },
  { word: 'MUSHROOM', emoji: '🍄' },
  { word: 'LIGHTHOUSE', emoji: '🗼' },
  { word: 'STRAWBERRY', emoji: '🍓' },
  { word: 'BUTTERFLY', emoji: '🦋' },
  { word: 'TELESCOPE', emoji: '🔭' },
  { word: 'PINEAPPLE', emoji: '🍍' },
  { word: 'SNOWFLAKE', emoji: '❄️' },
  { word: 'SUNFLOWER', emoji: '🌻' },
  { word: 'CROWN', emoji: '👑' },
  { word: 'DIAMOND', emoji: '💎' },
  { word: 'TROPHY', emoji: '🏆' },
  { word: 'BICYCLE', emoji: '🚲' },
  { word: 'BALLOON', emoji: '🎈' },
  { word: 'MAGNET', emoji: '🧲' },
  { word: 'CRYSTAL', emoji: '🔮' },
  { word: 'FLAMINGO', emoji: '🦩' },
  { word: 'OCTOPUS', emoji: '🐙' },
  { word: 'HOURGLASS', emoji: '⏳' },
  { word: 'FIREWORKS', emoji: '🎆' },
  { word: 'WATERFALL', emoji: '🌊' },
  { word: 'LANTERN', emoji: '🏮' },
  { word: 'SWORD', emoji: '⚔️' },
  { word: 'TORNADO', emoji: '🌪️' },
  { word: 'CRAB', emoji: '🦀' },
  { word: 'WIZARD', emoji: '🧙' },
  { word: 'PLANET', emoji: '🪐' },
  { word: 'VOLCANO', emoji: '🌋' },
  { word: 'CHERRY', emoji: '🍒' },
  { word: 'DRAGON', emoji: '🐲' },
  { word: 'IGLOO', emoji: '🧊' },
  { word: 'HAMMER', emoji: '🔨' },
  { word: 'COMPASS', emoji: '🧭' },
  { word: 'CANDLE', emoji: '🕯️' },
];

// Deterministic word selection based on room + round — all players pick the same word
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function getWordForRound(roomId, roundNumber) {
  const seed = Math.abs(hashCode(`${roomId}:${roundNumber}`));
  return WORDS[seed % WORDS.length];
}
