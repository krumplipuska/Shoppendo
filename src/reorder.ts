/** Geometry shared by the UI worklets and deterministic tests. All heights include row spacing. */
export const HOLD_MS = 300;
export type Heights = Record<string, number>;
export function rowTop(order: string[], heights: Heights, id: string) {
  'worklet';
  let y = 0;
  for (const key of order) { if (key === id) break; y += heights[key] ?? 64; }
  return y;
}
export function moveTo(order: string[], id: string, index: number) {
  'worklet';
  if (!order.includes(id)) return order;
  const next = order.filter(key => key !== id);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, id);
  return next;
}
/** Compare against current slot edges, with hysteresis to avoid boundary oscillation. */
export function previewOrder(order: string[], heights: Heights, id: string, top: number) {
  'worklet';
  let index = order.indexOf(id);
  if (index < 0) return order;
  let next = order;
  while (index < next.length - 1) {
    const neighbor = next[index + 1];
    const threshold = rowTop(next, heights, id) + (heights[neighbor] ?? 64) / 2 + 3;
    if (top <= threshold) break;
    next = moveTo(next, id, ++index);
  }
  while (index > 0) {
    const neighbor = next[index - 1];
    const threshold = rowTop(next, heights, id) - (heights[neighbor] ?? 64) / 2 - 3;
    if (top >= threshold) break;
    next = moveTo(next, id, --index);
  }
  return next;
}
export function edgeVelocity(finger: number, top: number, height: number) {
  'worklet';
  const edge = Math.min(80, height / 4);
  if (edge <= 0) return 0;
  const up = Math.max(0, Math.min(1, (top + edge - finger) / edge));
  const down = Math.max(0, Math.min(1, (finger - (top + height - edge)) / edge));
  return 720 * (down * down - up * up);
}
export function sameOrder(a: string[], b: string[]) {
  'worklet';
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
