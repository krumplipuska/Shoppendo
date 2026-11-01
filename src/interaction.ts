export function deleteSwipeProgress(distance: number, start: number) {
  'worklet';
  return Math.max(0, Math.min(1, start - distance / 84));
}

export function swipeAxis(x: number, y: number): 0 | 1 | 2 {
  'worklet';
  if (Math.abs(x) + Math.abs(y) < 3) return 0;
  return Math.abs(x) >= Math.abs(y) ? 1 : 2;
}

export function backSwipeDirection(x: number, y: number, velocityX = 0, velocityY = 0): 'left' | 'right' | 'down' | null {
  'worklet';
  if (Math.abs(x) > Math.abs(y)) {
    if (Math.abs(x) >= 72 || (Math.abs(x) > 24 && Math.abs(velocityX) > 650 && Math.sign(velocityX) === Math.sign(x))) return x < 0 ? 'left' : 'right';
  } else if (y >= 96 || (y > 24 && velocityY > 750)) return 'down';
  return null;
}
export function shouldStartListPull(x: number, y: number, scrollY: number) {
  'worklet';
  return scrollY <= 1 && y > 18 && y > Math.abs(x) * 1.5;
}

// Only lift by the keyboard area still covering the modal (Android may already resize it).
export function keyboardOverlap(viewportBottom: number, keyboard?: { screenY: number; height: number } | null) {
  return keyboard ? Math.max(0, Math.min(keyboard.height, viewportBottom - keyboard.screenY)) : 0;
}
