import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_RULES } from '../src/rules/index.ts';
import { parseRobots } from '../src/robots.ts';
import { runReadiness } from '../src/run.ts';
import type { PageSnapshot, ScanContext } from '../src/context.ts';

/**
 * الوسم `needs: 'products'` ادّعاء، وهذا الملف يثبته أو يُسقطه.
 *
 * الادّعاء: القاعدة الموسومة لا تنجح بلا صفحة منتج مهما كانت الرئيسية
 * مضبوطة، وغير الموسومة تنجح. فنبني رئيسيةً **مثالية** — كل مخطّط وكل
 * سعر وعنوانٌ واحد وصورٌ بنصوص بديلة وrobots وllms.txt وخريطة — ونمرّرها
 * بلا صفحات منتجات. ما يُخفق عندها هو بالتعريف ما لا يُقاس بلا منتجات.
 *
 * فإن أضاف أحدٌ قاعدةً تعتمد على صفحات المنتجات ونسي وسمها، أخفقت هنا.
 * وإن وسم قاعدةً لا تحتاجها، أخفقت هنا كذلك.
 */

const PERFECT_HOME: PageSnapshot = {
  url: 'https://shop.sa/',
  status: 200,
  headers: {},
  html: `<!doctype html><html lang="ar"><head>
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
<script type="application/ld+json">{"@type":"Organization","name":"متجر","url":"https://shop.sa"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body><main><h1>عباية سوداء</h1>
<img src="a.jpg" alt="عباية سوداء أمامية"><img src="b.jpg" alt="عباية سوداء خلفية">
</main></body></html>`,
};

const HOME_ONLY: ScanContext = {
  domain: 'shop.sa',
  home: PERFECT_HOME,
  products: [],
  robots: parseRobots(
    'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n' +
      'User-agent: OAI-SearchBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\n' +
      'User-agent: Google-Extended\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\n' +
      '\nSitemap: https://shop.sa/sitemap.xml\n'
  ),
  llmsTxt: '# متجر عبايات\n' + 'وصف المتجر وكتالوجه بتفصيل كافٍ. '.repeat(6),
  sitemapFound: true,
};

const marked = new Set(
  ACTIVE_RULES.filter((r) => r.active && r.needs === 'products').map((r) => r.key)
);

test('الموسومة هي بالضبط ما يُخفق على رئيسية مثالية بلا منتجات', () => {
  const failed = new Set(
    runReadiness(HOME_ONLY).results.filter((r) => !r.passed).map((r) => r.key)
  );

  assert.deepEqual(
    [...failed].sort(),
    [...marked].sort(),
    'قاعدة تحتاج المنتجات ولم تُوسم، أو وُسمت وهي لا تحتاجها'
  );
});

test('الوسم ليس فارغاً — وإلّا كان الاختبار أعلاه بلا معنى', () => {
  assert.ok(marked.size >= 4, `عدد الموسومة: ${marked.size}`);
  assert.ok(marked.has('schema.product'));
});

test('الموسومة تنجح حين توجد صفحة منتج — فالوسم قيد لا حكم', () => {
  const withProduct = runReadiness({
    ...HOME_ONLY,
    products: [{ ...PERFECT_HOME, url: 'https://shop.sa/p/1' }],
  });

  for (const key of marked) {
    const r = withProduct.results.find((x) => x.key === key);
    assert.equal(r?.passed, true, `${key} كان يجب أن تنجح على صفحة منتج مضبوطة`);
  }
});
