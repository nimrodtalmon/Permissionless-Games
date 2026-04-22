const ADJECTIVES = ['Quick', 'Brave', 'Sneaky', 'Loud', 'Happy', 'Grumpy', 'Jolly', 'Shy', 'Bold', 'Calm', 'Witty', 'Zesty', 'Fluffy', 'Tiny', 'Giant'];
const ANIMALS = ['Fox', 'Bear', 'Wolf', 'Deer', 'Hawk', 'Owl', 'Frog', 'Crab', 'Lynx', 'Mole', 'Panda', 'Zebra', 'Newt', 'Toad', 'Vole'];
const COLORS = ['#e74c3c', '#e67e22', '#16a085', '#2980b9', '#8e44ad', '#c0392b', '#d35400', '#27ae60', '#2471a3', '#6c3483', '#1a7a4a', '#b7950b'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getPlayer() {
  let id = localStorage.getItem('pg_player_id');
  let name = localStorage.getItem('pg_player_name');
  let color = localStorage.getItem('pg_player_color');

  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('pg_player_id', id);
  }
  if (!name) {
    name = pick(ADJECTIVES) + pick(ANIMALS);
    localStorage.setItem('pg_player_name', name);
  }
  if (!color) {
    color = pick(COLORS);
    localStorage.setItem('pg_player_color', color);
  }

  return { id, name, color };
}

export function setPlayerName(name) {
  localStorage.setItem('pg_player_name', name);
}
