export function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  let roomId = params.get('room');
  if (!roomId) {
    roomId = Math.random().toString(36).slice(2, 8);
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url.toString());
  }
  return roomId;
}

export function getRoomUrl() {
  return window.location.href;
}
