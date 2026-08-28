import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, readCapped, safeFetch } from '../src/safeFetch.ts';
import { BlockedHostError, InvalidUrlError, PayloadTooLargeError } from '@wakeelcheck/core';

test('normalizeUrl adds https when the scheme is missing', () => {
  assert.equal(normalizeUrl('mystore.sa').toString(), 'https://mystore.sa/');
  assert.equal(normalizeUrl('  mystore.sa  ').toString(), 'https://mystore.sa/');
});

test('normalizeUrl keeps an explicit scheme', () => {
  assert.equal(normalizeUrl('http://mystore.sa/x').toString(), 'http://mystore.sa/x');
});

test('normalizeUrl rejects non-http schemes', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://x.com', 'javascript:alert(1)', 'data:text/html,x', '']) {
    assert.throws(() => normalizeUrl(bad), InvalidUrlError, `${bad} must be rejected`);
  }
});

test('safeFetch refuses the cloud metadata endpoint', async () => {
  await assert.rejects(() => safeFetch('http://169.254.169.254/latest/meta-data/'), BlockedHostError);
});

test('safeFetch refuses loopback and private targets', async () => {
  for (const target of ['http://127.0.0.1:8080/', 'http://localhost:3000/', 'http://10.0.0.1/', 'http://[::1]/']) {
    await assert.rejects(() => safeFetch(target), BlockedHostError, `${target} must be refused`);
  }
});

// ── حدّ الحجم ────────────────────────────────────────────────
// نختبر readCapped مباشرةً: تمرير خادم محلي عبر safeFetch مستحيل بحق،
// لأن الحارس يمنع 127.0.0.1 — وهذا هو السلوك المطلوب منه.

test('readCapped rejects a body over the byte cap', async () => {
  const big = new Response('x'.repeat(50_000));

  await assert.rejects(
    () => readCapped(big, 'https://example.com/big', 1_000),
    PayloadTooLargeError
  );
});

test('readCapped returns a body under the cap intact', async () => {
  const payload = '<html><body>متجر عبايات</body></html>';
  const body = await readCapped(new Response(payload), 'https://example.com/', 1_000_000);

  assert.equal(body, payload);
});

test('readCapped handles an empty body', async () => {
  const empty = new Response(null, { status: 204 });
  assert.equal(await readCapped(empty, 'https://example.com/', 1000), '');
});

test('safeFetch reaches a real public host and reports timing', async (t) => {
  let result;
  try {
    result = await safeFetch('https://example.com', { timeoutMs: 15_000 });
  } catch {
    t.skip('no outbound network in this environment');
    return;
  }

  // بعض البيئات تمرّ عبر وكيل يردّ 403/407 — الاختبار يخصّ آلية الجلب لا الموقع.
  if (result.status === 403 || result.status === 407) {
    t.skip(`outbound proxy returned ${result.status}`);
    return;
  }

  assert.ok(result.status >= 200 && result.status < 400, `unexpected status ${result.status}`);
  assert.ok(result.ttfbMs >= 0);
  assert.ok(result.finalUrl.startsWith('https://example.com'));
  assert.equal(typeof result.headers['content-type'], 'string');
});
