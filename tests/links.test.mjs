import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shopLink, shopCodeFromLink, SHARE_ORIGIN } from '../src/links.ts';

test('shared links round-trip through the website and installed app', () => {
  const code = 'ABCDEFGHJKLMNPQRSTUV';
  assert.equal(shopLink('abcd-efgh-jklm-npqr-stuv'), `${SHARE_ORIGIN}/join/${code}`);
  assert.equal(shopCodeFromLink(shopLink(code)), code);
  assert.equal(shopCodeFromLink(`shoppendo://join/${code}`), code);
  assert.equal(shopCodeFromLink(`${shopLink(code)}/?source=message`), code);
  for (const input of ['not a url', `${SHARE_ORIGIN}/join/bad`, `${shopLink(code)}/extra`,
    `https://example.com/join/${code}`, `https://shoppendo-1a86c.web.app.evil.com/join/${code}`,
    `${SHARE_ORIGIN}/join/%ZZ`, `shoppendo://other/${code}`]) {
    assert.equal(shopCodeFromLink(input), null, input);
  }
  assert.throws(() => shopLink('bad'), /Invalid shop ID/);
});
