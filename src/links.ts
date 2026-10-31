import { normalizeCode } from './model.ts';

export const SHARE_ORIGIN = 'https://shoppendo-1a86c.web.app';

export function shopLink(code: string) {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error('Invalid shop ID.');
  return `${SHARE_ORIGIN}/join/${normalized}`;
}

export function shopCodeFromLink(input: string) {
  try {
    const url = new URL(input);
    const path = url.protocol === 'shoppendo:' && url.hostname === 'join'
      ? `/join${url.pathname}` : url.origin === SHARE_ORIGIN ? url.pathname : '';
    const match = /^\/join\/([^/]+)\/?$/.exec(path);
    return match ? normalizeCode(decodeURIComponent(match[1])) : null;
  } catch { return null; }
}
