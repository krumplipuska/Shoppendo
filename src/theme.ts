export const colors = {
  primary: '#2C6A54', primarySoft: '#E8F0E8', secondary: '#B45E45', secondarySoft: '#F8EDE7',
  text: '#213D33', muted: '#727E76', border: '#E2E7E0', white: '#FFFFFF', header: '#F7F8F4', background: '#F7F7F4', danger: '#A13C32',
};
export const fonts = {
  regular: 'DMSans_400Regular', medium: 'DMSans_500Medium', semibold: 'DMSans_600SemiBold', bold: 'DMSans_700Bold',
};

const entityPalette = ['#246B4D', '#86519A', '#237294', '#A45B23', '#A14F70', '#677B27', '#465CB0', '#A34739', '#247D78', '#846624', '#6555A1', '#476D83'];
// Colour assignment depends only on the set of ids; cache it so list rows don't re-sort and re-hash every render.
const toneCache = new Map<string, Map<string, string>>();
function assignTones(ids: string[]) {
  const key = ids.join('\u0000');
  const cached = toneCache.get(key);
  if (cached) return cached;
  const assigned = new Map<string, string>();
  const used = new Set<number>();
  for (const key of [...new Set(ids)].sort()) {
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    let index = hash % entityPalette.length;
    while (used.has(index) && used.size < entityPalette.length) index = (index + 1) % entityPalette.length;
    const color = used.size < entityPalette.length ? entityPalette[index] : `hsl(${(hash + assigned.size * 137.508) % 360}, 48%, 34%)`;
    used.add(index); assigned.set(key, color);
  }
  if (toneCache.size >= 32) toneCache.delete(toneCache.keys().next().value!);
  toneCache.set(key, assigned);
  return assigned;
}
export function entityTone(id: string, ids: string[]) {
  const color = assignTones(ids).get(id) ?? colors.primary;
  const soft = color.startsWith('#') ? `${color}18` : color.replace('34%', '94%');
  return { color, soft };
}
