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

// Move a visual gap without reordering/unmounting the registered drag targets.
export function itemDragLayout(ids: string[], drag: { source: string; target: string; after: boolean; height: number }) {
  const from = ids.indexOf(drag.source);
  const target = ids.indexOf(drag.target);
  const shifts: Record<string, number> = {};
  if (drag.source === drag.target || target < 0 && from < 0) return { shifts, delta: 0 };
  const without = ids.filter(id => id !== drag.source);
  const insertion = target < 0 ? -1 : without.indexOf(drag.target) + (drag.after ? 1 : 0);
  ids.forEach((id, index) => {
    if (id === drag.source) return;
    const base = index - (from >= 0 && index > from ? 1 : 0);
    shifts[id] = (from >= 0 && index > from ? -drag.height : 0) + (insertion >= 0 && base >= insertion ? drag.height : 0);
  });
  return { shifts, delta: (target >= 0 ? drag.height : 0) - (from >= 0 ? drag.height : 0) };
}

// Only lift by the keyboard area still covering the modal (Android may already resize it).
export function keyboardOverlap(viewportBottom: number, keyboard?: { screenY: number; height: number } | null) {
  return keyboard ? Math.max(0, Math.min(keyboard.height, viewportBottom - keyboard.screenY)) : 0;
}

// Preview, snap destination and persistence all use the source-removed insertion slot.
export function dragOrder(ids: string[], drag: { source: string; target: string; after: boolean }) {
  if (drag.source === drag.target || !ids.includes(drag.source) || !ids.includes(drag.target)) return ids;
  const next = ids.filter(id => id !== drag.source);
  next.splice(next.indexOf(drag.target) + (drag.after ? 1 : 0), 0, drag.source);
  return next.every((id, index) => ids[index] === id) ? ids : next;
}

export function dragSlotTop(ids: string[], drag: { source: string; target: string; after: boolean; height: number }, targetTop: number, targetHeight: number) {
  return targetTop + (drag.after ? targetHeight : 0) - (ids.indexOf(drag.source) < ids.indexOf(drag.target) ? drag.height : 0);
}

// Drax 1.1 movement offsets describe the hover centre. Drop offsets describe its top-left.
export function insertionSide(offset: { x: number; y: number }, receiver: { width: number; height: number },
  source: { width: number; height: number }, drop: boolean) {
  if (![receiver.width, receiver.height, source.width, source.height].every(n => Number.isFinite(n) && n > 0)) return null;
  const x = offset.x + (drop ? source.width / 2 : 0);
  const y = offset.y + (drop ? source.height / 2 : 0);
  if (!(x >= 0 && x <= receiver.width && y >= 0 && y <= receiver.height)) return null;
  return y >= receiver.height / 2;
}

export function dragSession() {
  let sequence = 0;
  let active = 0;
  return {
    start() { active = ++sequence; return active; },
    finish(token: number, commit?: () => void) {
      if (!active || active !== token) return false;
      active = 0;
      commit?.();
      return true;
    },
  };
}
