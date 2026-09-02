import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchResult, MatrixRow, RuleResult } from '@wakeelcheck/core';
import { profileRivals, type RivalDeps } from '../src/rivals.ts';

// ── تجهيزات ──────────────────────────────────────────────────

function page(html: string, url: string): FetchResult {
  return { status: 200, headers: {}, body: html, ttfbMs: 90, finalUrl: url, redirects: 0 };
}

/** رئيسية منافس تحمل رابط منتج، فيُكتشف بلا خريطة موقع. */
const RIVAL_HOME = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Organization","name":"بيت الأناقة"}</script>
</head><body><h1>بيت الأناقة</h1><a href="/products/abaya-1">عباية</a></body></html>`;

/** صفحة منتج مضبوطة — تُنجح قواعد المنتج عند المنافس. */
const RIVAL_PRODUCT = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
"name":"عباية","brand":{"@type":"Brand","name":"بيت الأناقة"},
"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"90"},
"offers":{"@type":"Offer","price":"349.00","priceCurrency":"SAR",
"availability":"https://schema.org/InStock"}}</script>
</head><body><h1>عباية</h1><img src="a.jpg" alt="عباية"></body></html>`;

function rivalDeps(over: Partial<RivalDeps> = {}): RivalDeps {
  return {
    async fetchPage(url) {
      return url.includes('/products/') ? page(RIVAL_PRODUCT, url) : page(RIVAL_HOME, url);
    },
    async fetchText(url) {
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /\n';
      return null;
    },
    ...over,
  };
}

function row(name: string, present: number, domain: string | null, isStore = false): MatrixRow {
  return { name, domain, isStore, cells: [], present, measured: 4 };
}

function rule(key: string, passed: boolean, weight = 5): RuleResult {
  return { key, passed, weight, detail: { ar: '', en: '' }, evidence: '' };
}

/** متجرٌ أخفق في كل قاعدة — فكل ما يضبطه المنافس يظهر سبقاً. */
const STORE_ALL_FAILING: RuleResult[] = [
  rule('schema.product', false, 10),
  rule('schema.offer', false, 10),
  rule('schema.organization', false, 7),
  rule('robots.gptbot', false, 10),
];

// ── الفحص ────────────────────────────────────────────────────

test('يفحص المنافس بنفس القواعد ويُخرج ما سبقنا فيه', async () => {
  const report = await profileRivals(
    [row('متجرك', 1, 'you.sa', true), row('بيت الأناقة', 4, 'anaqa.sa')],
    STORE_ALL_FAILING,
    20,
    rivalDeps()
  );

  assert.equal(report.profiled.length, 1);
  const rival = report.profiled[0];
  assert.equal(rival?.domain, 'anaqa.sa');
  assert.equal(rival?.present, 4);
  assert.equal(report.storeScore, 20);

  const keys = rival?.ahead.map((d) => d.ruleKey) ?? [];
  assert.ok(keys.includes('schema.product'), 'ضبط مخطّط المنتج ونحن لا');
  assert.ok(keys.includes('robots.gptbot'), 'يسمح لـGPTBot ونحن لا');
  assert.deepEqual(rival?.behind, [], 'لم نضبط شيئاً أخفق فيه');
});

test('الأثقل وزناً أولاً — ترتيب الإصلاح', async () => {
  const report = await profileRivals(
    [row('r', 3, 'anaqa.sa')],
    STORE_ALL_FAILING,
    20,
    rivalDeps()
  );

  const weights = report.profiled[0]?.ahead.map((d) => d.weight) ?? [];
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
  assert.ok(weights.length > 0);
});

test('منافس لا يُجاب لا يُسقط البقيّة', async () => {
  const deps = rivalDeps({
    async fetchPage(url) {
      if (url.includes('down.sa')) throw new Error('ECONNREFUSED');
      return url.includes('/products/') ? page(RIVAL_PRODUCT, url) : page(RIVAL_HOME, url);
    },
  });

  const report = await profileRivals(
    [row('ساقط', 5, 'down.sa'), row('حيّ', 4, 'anaqa.sa')],
    STORE_ALL_FAILING,
    20,
    deps
  );

  assert.deepEqual(report.profiled.map((p) => p.domain), ['anaqa.sa']);
  assert.deepEqual(report.skipped, [
    { name: 'ساقط', domain: 'down.sa', reason: 'unreachable' },
  ]);
});

test('صفحة منتج تعذّرت لا تُسقط المنافس', async () => {
  const deps = rivalDeps({
    async fetchPage(url) {
      if (url.includes('/products/')) throw new Error('timeout');
      return page(RIVAL_HOME, url);
    },
  });

  const report = await profileRivals([row('r', 3, 'anaqa.sa')], STORE_ALL_FAILING, 20, deps);

  assert.equal(report.profiled.length, 1, 'فُحص بما توفّر');
});

test('بلا صفحة منتج تخرج قواعد المنتج من المقارنة كلّها', async () => {
  // رئيسية بلا أي رابط منتج: لا نجد عنده ما نقيس عليه.
  const deps = rivalDeps({
    async fetchPage(url) {
      return page('<html><body><h1>بيت</h1></body></html>', url);
    },
  });

  const report = await profileRivals([row('r', 3, 'anaqa.sa')], STORE_ALL_FAILING, 20, deps);

  const touched = [
    ...(report.profiled[0]?.ahead ?? []),
    ...(report.profiled[0]?.behind ?? []),
  ].map((d) => d.ruleKey);

  assert.ok(!touched.includes('schema.product'), 'غياب القياس ليس تفوّقاً لنا');
  assert.ok(!touched.includes('schema.offer'));
});

test('ما ضبطناه وأخفق فيه يظهر — الصورة متوازنة', async () => {
  // منافسٌ يحجب GPTBot ونحن نسمح: سبقٌ لنا، ويُعرض كما يُعرض تأخّرنا.
  // (غيابُ robots.txt إباحةٌ لا حجب — RFC 9309 — فالحجب يحتاج نصّاً صريحاً.)
  const blocksGptBot = rivalDeps({
    async fetchText(url) {
      return url.endsWith('/robots.txt') ? 'User-agent: GPTBot\nDisallow: /\n' : null;
    },
  });

  const report = await profileRivals(
    [row('r', 3, 'anaqa.sa')],
    [rule('robots.gptbot', true, 10)],
    80,
    blocksGptBot
  );

  const behind = report.profiled[0]?.behind.map((d) => d.ruleKey) ?? [];
  assert.ok(behind.includes('robots.gptbot'));
});

test('السقف يُطبَّق ويظهر في التقرير', async () => {
  const report = await profileRivals(
    [row('a', 5, 'a.sa'), row('b', 4, 'b.sa'), row('c', 3, 'c.sa')],
    STORE_ALL_FAILING,
    20,
    rivalDeps(),
    { cap: 1 }
  );

  assert.equal(report.cap, 1);
  assert.equal(report.profiled.length, 1);
  assert.deepEqual(
    report.skipped.map((s) => s.reason),
    ['over_cap', 'over_cap'],
    'من تجاوز السقف يُذكر لا يُحذف'
  );
});

test('بلا منافسين لا شبكة ولا انكسار', async () => {
  let touched = 0;
  const report = await profileRivals([row('متجرك', 1, 'you.sa', true)], STORE_ALL_FAILING, 20, {
    async fetchPage() { touched += 1; return page('', ''); },
    async fetchText() { touched += 1; return null; },
  });

  assert.equal(touched, 0, 'لا طلب واحد');
  assert.deepEqual(report.profiled, []);
  assert.deepEqual(report.skipped, []);
});

test('التقرير يبدأ بمن تتعلّم منه أكثر', async () => {
  // منافسان: واحد مضبوط وآخر ضعيف. الأكثر سبقاً يتصدّر مهما كان اسمه.
  const deps = rivalDeps({
    async fetchPage(url) {
      if (url.includes('weak.sa')) return page('<html><body><h1>ضعيف</h1></body></html>', url);
      return url.includes('/products/') ? page(RIVAL_PRODUCT, url) : page(RIVAL_HOME, url);
    },
    async fetchText(url) {
      if (!url.endsWith('/robots.txt')) return null;
      return url.includes('weak.sa') ? 'User-agent: GPTBot\nDisallow: /\n' : 'User-agent: *\nAllow: /\n';
    },
  });

  const report = await profileRivals(
    [row('ضعيف', 5, 'weak.sa'), row('قويّ', 4, 'anaqa.sa')],
    STORE_ALL_FAILING,
    20,
    deps
  );

  const [first, second] = report.profiled;
  assert.equal(first?.domain, 'anaqa.sa', 'الأكثر سبقاً أولاً وإن كان أقل حضوراً');
  assert.ok((first?.ahead.length ?? 0) > (second?.ahead.length ?? 0));
});
