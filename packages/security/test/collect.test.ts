import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certInfoFrom,
  findScriptUrls,
  joinTxt,
  parseRdapExpiry,
  pickDmarc,
  pickSpf,
} from '../src/collect.ts';

// ── RDAP ─────────────────────────────────────────────────────

test('parseRdapExpiry reads the expiration event', () => {
  const payload = {
    events: [
      { eventAction: 'registration', eventDate: '2019-03-01T00:00:00Z' },
      { eventAction: 'expiration', eventDate: '2026-09-30T00:00:00Z' },
    ],
  };

  assert.equal(parseRdapExpiry(payload), '2026-09-30T00:00:00.000Z');
});

test('parseRdapExpiry accepts the registrar wording too', () => {
  const payload = { events: [{ eventAction: 'Registrar Expiration', eventDate: '2026-12-01' }] };

  assert.match(parseRdapExpiry(payload) ?? '', /^2026-12-01/);
});

test('parseRdapExpiry returns null rather than guessing', () => {
  // نطاق بلا تاريخ خير من تاريخ مخترع — التقييم يتجاهل null ولا يُنذر.
  for (const payload of [
    null,
    'not an object',
    {},
    { events: 'nope' },
    { events: [] },
    { events: [{ eventAction: 'registration', eventDate: '2019-01-01' }] },
    { events: [{ eventAction: 'expiration' }] },
    { events: [{ eventAction: 'expiration', eventDate: 'garbage' }] },
  ]) {
    assert.equal(parseRdapExpiry(payload), null, JSON.stringify(payload));
  }
});

test('parseRdapExpiry takes the first expiry event when several exist', () => {
  const payload = {
    events: [
      { eventAction: 'expiration', eventDate: '2026-09-30T00:00:00Z' },
      { eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' },
    ],
  };

  assert.match(parseRdapExpiry(payload) ?? '', /^2026-09-30/);
});

// ── DNS ──────────────────────────────────────────────────────

test('joinTxt reassembles records split at 255 characters', () => {
  assert.deepEqual(joinTxt([['v=spf1 ', 'include:_spf.google.com ~all']]), [
    'v=spf1 include:_spf.google.com ~all',
  ]);
});

test('pickSpf finds the SPF record among unrelated TXT entries', () => {
  const records = [
    ['google-site-verification=abc'],
    ['v=spf1 include:_spf.google.com ~all'],
    ['MS=ms12345'],
  ];

  assert.equal(pickSpf(records), 'v=spf1 include:_spf.google.com ~all');
});

test('pickSpf ignores a record that merely mentions spf', () => {
  assert.equal(pickSpf([['notes: our spf1 setup is pending']]), null);
});

test('pickDmarc reads the policy record', () => {
  assert.equal(pickDmarc([['v=DMARC1; p=reject; rua=mailto:x@shop.sa']]), 'v=DMARC1; p=reject; rua=mailto:x@shop.sa');
});

test('DMARC matching is case-insensitive', () => {
  assert.notEqual(pickDmarc([['v=dmarc1; p=none']]), null);
});

test('no records means null, not an error', () => {
  assert.equal(pickSpf([]), null);
  assert.equal(pickDmarc([]), null);
});

// ── سكربتات الصفحة ───────────────────────────────────────────

const HTML = `<html><head>
<script src="/assets/app.js"></script>
<script src="https://cdn.other.com/analytics.js"></script>
<script src="https://shop.sa/bundle.js"></script>
<script>inline()</script>
</head></html>`;

test('own-domain scripts come before third-party ones', () => {
  // مفتاح التاجر المسرّب يكون في حزمته هو، لا في سكربت تحليلات خارجي.
  const urls = findScriptUrls(HTML, 'https://shop.sa/');

  assert.deepEqual(urls, [
    'https://shop.sa/assets/app.js',
    'https://shop.sa/bundle.js',
    'https://cdn.other.com/analytics.js',
  ]);
});

test('inline scripts have no URL to collect', () => {
  assert.deepEqual(findScriptUrls('<script>var a=1</script>', 'https://shop.sa/'), []);
});

test('duplicate sources are collected once', () => {
  const html = '<script src="/a.js"></script><script src="/a.js"></script>';

  assert.equal(findScriptUrls(html, 'https://shop.sa/').length, 1);
});

test('non-http sources are skipped', () => {
  const html = '<script src="data:text/javascript,alert(1)"></script><script src="/ok.js"></script>';

  assert.deepEqual(findScriptUrls(html, 'https://shop.sa/'), ['https://shop.sa/ok.js']);
});

test('the limit is respected', () => {
  const html = Array.from({ length: 20 }, (_v, i) => `<script src="/s${i}.js"></script>`).join('');

  assert.equal(findScriptUrls(html, 'https://shop.sa/', 5).length, 5);
});

test('a broken base URL yields nothing rather than throwing', () => {
  assert.deepEqual(findScriptUrls(HTML, 'not a url'), []);
});

// ── الشهادة ──────────────────────────────────────────────────

test('certInfoFrom normalises the OpenSSL date format', () => {
  const info = certInfoFrom({ valid_to: 'Nov 14 23:59:59 2026 GMT' }, 'TLSv1.3');

  assert.match(info.expiresAt ?? '', /^2026-11-14/);
  assert.equal(info.protocol, 'TLSv1.3');
});

test('a certificate with no date reports null', () => {
  assert.deepEqual(certInfoFrom({}, 'TLSv1.3'), { expiresAt: null, protocol: 'TLSv1.3' });
});

test('an unparseable date reports null but keeps the protocol', () => {
  const info = certInfoFrom({ valid_to: 'sometime next year' }, 'TLSv1.2');

  assert.equal(info.expiresAt, null);
  assert.equal(info.protocol, 'TLSv1.2');
});
