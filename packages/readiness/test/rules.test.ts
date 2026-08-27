import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_RULES } from '../src/rules/index.ts';
import { parseRobots } from '../src/robots.ts';
import { gradeFor, runReadiness } from '../src/run.ts';
import type { PageSnapshot, ScanContext } from '../src/context.ts';

// ── تجهيزات ──────────────────────────────────────────────────

function page(html: string, url = 'https://shop.sa/p/1'): PageSnapshot {
  return { url, status: 200, headers: {}, html };
}

const GOOD_PRODUCT = page(`<!doctype html><html lang="ar"><head>
<meta property="og:title" content="عباية سوداء">
<meta property="product:price:amount" content="299.00">
<meta property="product:price:currency" content="SAR">
<meta property="product:availability" content="instock">
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Product","name":"عباية سوداء",
  "brand":{"@type":"Brand","name":"دار الأناقة"},
  "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.7","reviewCount":"120"},
  "offers":{"@type":"Offer","price":"299.00","priceCurrency":"SAR",
            "availability":"https://schema.org/InStock"}
}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body><main><h1>عباية سوداء</h1>
<img src="a.jpg" alt="عباية سوداء أمامية"><img src="b.jpg" alt="عباية سوداء خلفية">
</main></body></html>`);

const BAD_PRODUCT = page(`<!doctype html><html><head><title>منتج</title></head>
<body><h1>منتج</h1><h1>عرض</h1><img src="a.jpg"><img src="b.jpg"><img src="c.jpg"></body></html>`);

const HOME_WITH_ORG = page(
  `<!doctype html><html><head><script type="application/ld+json">
   {"@type":"Organization","name":"متجر","url":"https://shop.sa"}</script></head>
   <body><h1>الرئيسية</h1></body></html>`,
  'https://shop.sa/'
);

const BARE_HOME = page('<!doctype html><html><body><h1>الرئيسية</h1></body></html>', 'https://shop.sa/');

function ctx(over: Partial<ScanContext> = {}): ScanContext {
  return {
    domain: 'shop.sa',
    home: HOME_WITH_ORG,
    products: [GOOD_PRODUCT],
    robots: parseRobots(
      'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n' +
        'User-agent: OAI-SearchBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\n' +
        'User-agent: Google-Extended\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\n' +
        '\nSitemap: https://shop.sa/sitemap.xml\n'
    ),
    llmsTxt: '# متجر عبايات\n' + 'وصف المتجر وكتالوجه بتفصيل كافٍ. '.repeat(6),
    sitemapFound: true,
    ...over,
  };
}

/**
 * متجر يحظر كل البوتات — لكن ملف robots عنده موجود.
 * قواعد الوصول ترسب، وقاعدة وجود الملف تنجح بحق.
 */
function blockedCtx(): ScanContext {
  return {
    domain: 'shop.sa',
    home: BARE_HOME,
    products: [BAD_PRODUCT],
    robots: parseRobots('User-agent: *\nDisallow: /\n'),
    llmsTxt: null,
    sitemapFound: false,
  };
}

/**
 * متجر بلا أي ملفات إطلاقاً.
 * قاعدة وجود robots ترسب — وقواعد الوصول تنجح، لأن غياب الملف
 * يعني غياب القيود. الحالتان مختلفتان، ولا يصحّ دمجهما.
 */
function barrenCtx(): ScanContext {
  return {
    domain: 'shop.sa',
    home: BARE_HOME,
    products: [BAD_PRODUCT],
    robots: parseRobots(null),
    llmsTxt: null,
    sitemapFound: false,
  };
}

function byKey(context: ScanContext): Map<string, boolean> {
  return new Map(runReadiness(context).results.map((r) => [r.key, r.passed]));
}

// ── كل قاعدة تنجح في السياق الجيد وترسب في السيئ ─────────────

test('every active rule passes on a well-formed store', () => {
  const passed = byKey(ctx());

  for (const rule of ACTIVE_RULES) {
    assert.equal(passed.get(rule.key), true, `${rule.key} should pass`);
  }
});

test('every active rule is falsifiable — none passes unconditionally', () => {
  // العطب الأكبر في المحرّك القديم كان قواعد تنجح دائماً مهما كان المتجر،
  // فتضخّم النتيجة بلا أن تقيس شيئاً. هذا الاختبار يمنع عودتها.
  const blocked = byKey(blockedCtx());
  const barren = byKey(barrenCtx());

  for (const rule of ACTIVE_RULES) {
    const failsSomewhere = blocked.get(rule.key) === false || barren.get(rule.key) === false;
    assert.ok(failsSomewhere, `${rule.key} never fails — it measures nothing`);
  }
});

test('a missing robots.txt is not the same as one that blocks everyone', () => {
  const blocked = byKey(blockedCtx());
  const barren = byKey(barrenCtx());

  assert.equal(blocked.get('robots.file'), true, 'the file exists, it just says no');
  assert.equal(blocked.get('robots.gptbot'), false, 'and ChatGPT is refused');

  assert.equal(barren.get('robots.file'), false, 'here the file is absent');
  assert.equal(barren.get('robots.gptbot'), true, 'so nothing restricts ChatGPT');
});

// ── الإصلاح الأول: robots ────────────────────────────────────

test('a store blocking every bot fails the access rules', () => {
  const passed = byKey(ctx({ robots: parseRobots('User-agent: *\nDisallow: /\n') }));

  assert.equal(passed.get('robots.gptbot'), false);
  assert.equal(passed.get('robots.google_extended'), false);
});

test('a store welcoming GPTBot passes it', () => {
  const passed = byKey(
    ctx({ robots: parseRobots('User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /cart\n') })
  );

  assert.equal(passed.get('robots.gptbot'), true);
});

// ── الإصلاح الثاني: صفحات المنتج لا الرئيسية ─────────────────

test('product schema rules are evaluated on product pages, not the homepage', () => {
  // الرئيسية بلا مخطط منتج — وهذا طبيعي تماماً — بينما صفحة المنتج مضبوطة.
  const passed = byKey(ctx({ home: BARE_HOME, products: [GOOD_PRODUCT] }));

  assert.equal(passed.get('schema.product'), true, 'a bare homepage must not sink the store');
  assert.equal(passed.get('schema.offer'), true);
});

test('with no product pages discovered, product rules fail honestly', () => {
  const report = runReadiness(ctx({ products: [] }));
  const product = report.results.find((r) => r.key === 'schema.product');

  assert.equal(product?.passed, false);
  assert.match(product?.evidence ?? '', /homepage \(no product pages found\)/);
});

// ── الاتساق ──────────────────────────────────────────────────

test('price disagreement between Schema and OpenGraph is caught', () => {
  const mismatched = page(`<html><head>
    <meta property="product:price:amount" content="199.00">
    <script type="application/ld+json">{"@type":"Product",
      "offers":{"@type":"Offer","price":"299.00","priceCurrency":"SAR"}}</script>
    </head><body><h1>x</h1></body></html>`);

  assert.equal(byKey(ctx({ products: [mismatched] })).get('consistency.price'), false);
});

test('identical prices written differently still agree', () => {
  const equivalent = page(`<html><head>
    <meta property="product:price:amount" content="299">
    <script type="application/ld+json">{"@type":"Product",
      "offers":{"@type":"Offer","price":"299.00","priceCurrency":"SAR",
                "availability":"https://schema.org/InStock"}}</script>
    </head><body><main><h1>x</h1><img src="a.jpg" alt="a"></main></body></html>`);

  assert.equal(byKey(ctx({ products: [equivalent] })).get('consistency.price'), true);
});

// ── الإصلاح الثالث: النتيجة موزونة ───────────────────────────

test('the score is weighted, not a count of passing rules', () => {
  const report = runReadiness(ctx());

  assert.equal(report.score, 100);
  assert.equal(report.weightPassed, report.weightTotal);
  assert.ok(report.weightTotal > ACTIVE_RULES.length, 'weights must exceed a plain count');
});

test('failing a heavy rule costs more than failing a light one', () => {
  const heavy = runReadiness(ctx({ robots: parseRobots('User-agent: GPTBot\nDisallow: /\n') }));
  const light = runReadiness(ctx({ llmsTxt: null }));

  assert.ok(heavy.score < light.score, 'blocking ChatGPT must hurt more than a missing llms.txt');
});

test('failures are ordered by weight so the fix list is prioritised', () => {
  const { failures } = runReadiness(blockedCtx());

  assert.ok(failures.length > 0);
  for (let i = 1; i < failures.length; i++) {
    const prev = failures[i - 1];
    const cur = failures[i];
    assert.ok(prev !== undefined && cur !== undefined && prev.weight >= cur.weight);
  }
});

test('a well-formed store scores 100, a neglected one scores low', () => {
  assert.equal(runReadiness(ctx()).score, 100);
  assert.ok(runReadiness(blockedCtx()).score < 20, 'blocking every bot must be near-fatal');
  assert.ok(runReadiness(barrenCtx()).score < 60, 'no schema and no files must hurt');
});

test('grade boundaries', () => {
  assert.equal(gradeFor(100), 'A');
  assert.equal(gradeFor(90), 'A');
  assert.equal(gradeFor(89), 'B');
  assert.equal(gradeFor(75), 'B');
  assert.equal(gradeFor(55), 'C');
  assert.equal(gradeFor(35), 'D');
  assert.equal(gradeFor(34), 'F');
});

// ── المتانة ──────────────────────────────────────────────────

test('a rule that throws is reported, not fatal', () => {
  const exploding = {
    key: 'test.explodes',
    weight: 5,
    active: true,
    evaluate(): never {
      throw new Error('boom');
    },
  };

  const report = runReadiness(ctx(), [...ACTIVE_RULES, exploding]);
  const failed = report.results.find((r) => r.key === 'test.explodes');

  assert.equal(failed?.passed, false);
  assert.equal(failed?.evidence, 'boom');
  assert.ok(report.results.length > 1, 'other rules still ran');
});

test('malformed JSON-LD does not crash the scan', () => {
  const broken = page(
    '<html><head><script type="application/ld+json">{ not json }</script></head>' +
      '<body><h1>x</h1></body></html>'
  );

  assert.doesNotThrow(() => runReadiness(ctx({ products: [broken] })));
});

test('inactive rules are skipped entirely', () => {
  const parked = { ...ACTIVE_RULES[0]!, key: 'test.parked', active: false };
  const report = runReadiness(ctx(), [...ACTIVE_RULES, parked]);

  assert.equal(
    report.results.find((r) => r.key === 'test.parked'),
    undefined
  );
});

test('failing rules carry a fix snippet where one exists', () => {
  const { failures } = runReadiness(blockedCtx());
  const blocked = failures.find((r) => r.key === 'robots.gptbot');

  assert.match(blocked?.fixSnippet ?? '', /User-agent: GPTBot\nAllow: \//);
});
