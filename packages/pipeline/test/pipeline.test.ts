import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchResult } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import { PLANS, runScan, type PipelineDeps, type SecurityCollected } from '../src/pipeline.ts';

const NOW = new Date('2026-08-27T00:00:00Z');

const HOME = `<!doctype html><html lang="ar-SA"><head>
<title>دار الأناقة — عبايات فاخرة</title>
<meta name="description" content="عبايات نسائية فاخرة بالرياض">
<script>window.Salla = {};</script>
</head><body><h1>دار الأناقة</h1>
<a href="/products/abaya-1">عباية</a><a href="/products/abaya-2">عباية ٢</a>
<span>299 ر.س</span></body></html>`;

const PRODUCT = `<!doctype html><html lang="ar"><head>
<meta property="product:price:amount" content="299.00">
<meta property="product:price:currency" content="SAR">
<script type="application/ld+json">{"@type":"Product","name":"عباية",
 "brand":{"@type":"Brand","name":"دار الأناقة"},
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6"},
 "offers":{"@type":"Offer","price":"299.00","priceCurrency":"SAR",
           "availability":"https://schema.org/InStock"}}</script>
</head><body><main><h1>عباية</h1><img src="a.jpg" alt="عباية"></main></body></html>`;

const ANSWER = 'من أبرز الخيارات بيت العباية — تصاميم راقية وتوصيل سريع.';

function page(html: string, url: string): FetchResult {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: html,
    ttfbMs: 120,
    finalUrl: url,
    redirects: 0,
  };
}

const SECURITY: SecurityCollected = {
  domainInfo: { expiresAt: new Date(NOW.getTime() + 34 * 86_400_000).toISOString() },
  cert: { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000).toISOString(), protocol: 'TLSv1.3' },
  mail: { spf: 'v=spf1 ~all', dmarc: null },
  jsAssets: [],
  danglingCnames: [],
};

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  let counter = 0;

  return {
    async fetchPage(url) {
      return url.includes('/products/')
        ? page(PRODUCT, url)
        : page(HOME, 'https://daralanaqa.sa/');
    },
    async fetchText(url) {
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /\nSitemap: https://daralanaqa.sa/sitemap.xml\n';
      if (url.endsWith('/sitemap.xml')) return '<urlset><url><loc>https://daralanaqa.sa/products/abaya-1</loc></url></urlset>';
      return null;
    },
    async askEngine() {
      return { text: ANSWER, citedUrls: ['https://baitalabaya.sa'], costMicros: 1200 };
    },
    async collectSecurity() {
      return SECURITY;
    },
    llm: fakeProvider({
      scripts: [
        {
          match: /النطاق:/,
          reply: '{"category":"عبايات نسائية","city":"الرياض","brandName":"دار الأناقة"}',
        },
        {
          match: /العدد المطلوب/,
          reply: JSON.stringify({
            questions: [
              { text: 'وش أفضل متجر عبايات فخمة بالرياض؟', intent: 'discovery' },
              { text: 'عبايات بأقل من 300 ريال مع توصيل سريع؟', intent: 'price' },
            ],
          }),
        },
      ],
      fallbackReply: '{"competitors":[{"name":"بيت العباية","domain":null}]}',
    }),
    now: () => NOW,
    newId: () => `scan-${++counter}`,
    ...over,
  };
}

// ── الفحص الكامل ─────────────────────────────────────────────

test('a full scan produces every part of the report', async () => {
  const { result, costMicros } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());

  assert.equal(result.status, 'done');
  assert.equal(result.profile?.platform, 'salla');
  assert.equal(result.profile?.category, 'عبايات نسائية');
  assert.equal(result.profile?.city, 'الرياض');
  assert.equal(result.profile?.currency, 'SAR');
  assert.ok(result.questions.length > 0);
  assert.ok(result.answers.length > 0);
  assert.ok(result.rules.length > 0);
  assert.ok(result.security.length > 0);
  assert.ok(costMicros > 0, 'cost is accumulated for accounting');
});

test('the answer text is stored verbatim — rule 05', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());

  assert.equal(result.answers[0]?.answerText, ANSWER);
});

test('the store is absent and the competitor is named', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());

  assert.equal(result.answers[0]?.storeMentioned, false);
  assert.equal(result.answers[0]?.competitors[0]?.name, 'بيت العباية');
  assert.equal(result.shareOfVoice.store, 0);
  assert.equal(result.shareOfVoice.top?.name, 'بيت العباية');
  assert.equal(result.shareOfVoice.total, result.answers.length);
});

test('a store that is mentioned is recorded as such', async () => {
  const mentioned = 'أنصح بـ دار الأناقة أولاً، وأيضاً بيت العباية.';
  const { result } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({ askEngine: async () => ({ text: mentioned, citedUrls: [], costMicros: 0 }) })
  );

  assert.equal(result.answers[0]?.storeMentioned, true);
  assert.equal(result.shareOfVoice.store, result.answers.length);
});

// ── الخطط ────────────────────────────────────────────────────

test('a quick scan asks one engine but still carries the full diagnosis', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'quick' }, deps());

  // محرّك واحد يفصل المجاني عن المدفوع — لا حجبُ التشخيص.
  assert.deepEqual([...new Set(result.answers.map((a) => a.engine))], ['chatgpt']);
  assert.ok(result.rules.length > 0, 'the diagnosis is evidence — it is shown, not withheld');
  assert.ok(result.security.length > 0, 'and the security findings with it');
});

test('a full scan asks every engine for every question', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());

  assert.equal(result.answers.length, result.questions.length * PLANS.full.engines.length);
});

// ── المتانة: الجزء يسقط، الفحص يكمل ─────────────────────────

test('an unreachable store fails the scan cleanly', async () => {
  const { result } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      fetchPage: async () => {
        throw new Error('DNS resolution failed');
      },
    })
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'DNS resolution failed');
  assert.equal(result.profile, null);
});

test('one failing engine does not sink the others', async () => {
  let call = 0;
  const { result, warnings } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      askEngine: async () => {
        if (++call % 2 === 0) throw new Error('engine timeout');
        return { text: ANSWER, citedUrls: [], costMicros: 100 };
      },
    })
  );

  assert.equal(result.status, 'done');
  assert.ok(result.answers.length > 0, 'the answers that succeeded are kept');
  assert.ok(warnings.some((w) => w.includes('engine timeout')));
});

test('a failing security collection leaves the rest intact', async () => {
  const { result, warnings } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      collectSecurity: async () => {
        throw new Error('RDAP unavailable');
      },
    })
  );

  assert.equal(result.status, 'done');
  assert.deepEqual(result.security, []);
  assert.ok(result.answers.length > 0);
  assert.ok(warnings.some((w) => w.startsWith('security:')));
});

test('an unfetchable product page is noted, not fatal', async () => {
  const { result, warnings } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async fetchPage(url) {
        if (url.includes('/products/')) throw new Error('404');
        return page(HOME, 'https://daralanaqa.sa/');
      },
    })
  );

  assert.equal(result.status, 'done');
  assert.ok(warnings.some((w) => w.startsWith('product ')));
});

test('a store with no readable profile still gets scanned', async () => {
  const { result } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({ llm: fakeProvider({ fallbackReply: 'عذراً لا أستطيع' }) })
  );

  assert.equal(result.status, 'done');
  assert.equal(result.profile?.platform, 'salla', 'free heuristics still work');
  assert.equal(result.profile?.currency, 'SAR');
});

// ── التفاصيل ─────────────────────────────────────────────────

test('the sitemap supplies product URLs', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());

  assert.ok(result.profile?.productUrls.includes('https://daralanaqa.sa/products/abaya-1'));
});

test('product rules are evaluated, so a good product page passes', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'full' }, deps());
  const product = result.rules.find((r) => r.key === 'schema.product');

  assert.equal(product?.passed, true, 'the homepage carries no Product schema, and should not have to');
});

test('the domain expiry alarm reaches the report', async () => {
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'quick' }, deps());
  const alarm = result.security.find((f) => f.kind === 'domain_expiry');

  assert.equal(alarm?.title.ar, 'نطاقك ينتهي بعد 34 يوماً');
});

test('www is stripped from the domain', async () => {
  const { result } = await runScan(
    { url: 'www.daralanaqa.sa', kind: 'quick' },
    deps({ fetchPage: async () => page(HOME, 'https://www.daralanaqa.sa/') })
  );

  assert.equal(result.profile?.domain, 'daralanaqa.sa');
});

test('each scan gets its own id', async () => {
  const shared = deps();
  const a = await runScan({ url: 'daralanaqa.sa', kind: 'quick' }, shared);
  const b = await runScan({ url: 'daralanaqa.sa', kind: 'quick' }, shared);

  assert.notEqual(a.result.id, b.result.id);
});
