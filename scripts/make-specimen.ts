/**
 * يولّد نموذج تقرير من خطّ الأنابيب الحقيقي.
 *
 *   npx tsx scripts/make-specimen.ts
 *
 * المدخل ثابت (fixture) — متجر مُختلق بـHTML وrobots وشهادة ونطاق مكتوبة
 * هنا. المخرَج ليس مكتوباً: `runScan` هي التي تحسبه، بنفس القواعد الثمانَ
 * عشرة ونفس مقيّمات الأمن التي تعمل في الإنتاج.
 *
 * لهذا يصلح النموذج أساساً للتصميم: شكل التقرير ونتائج قواعده مطابقان لما
 * سيراه أول تاجر، ولا شيء فيه مُخترَع ليبدو جميلاً.
 *
 * ما لا يستطيع هذا السكربت توليده هو إجابات المحرّكات الحقيقية — تحتاج
 * مفتاحاً. الإجابات هنا نصوص ثابتة، والملف يعلّمها كذلك حتى لا تُقرأ
 * كقياس. القاعدة 06.
 */

import { writeFileSync } from 'node:fs';
import type { FetchResult } from '../packages/core/src/index.ts';
import {
  profileRivals,
  runScan,
  type PipelineDeps,
  type SecurityCollected,
} from '../packages/pipeline/src/index.ts';
import { buildMatrix } from '../packages/visibility/src/index.ts';
import { fakeProvider } from '../packages/llm/src/index.ts';

const DOMAIN = 'nourabaya.sa';
const NOW = new Date('2026-08-28T09:14:00.000Z');

// ── المدخل الثابت ────────────────────────────────────────────

/** متجر عليه أخطاء حقيقية شائعة: بلا Product Schema، وأسعار غير متسقة. */
const HOME = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>نور العباية — عبايات نسائية فاخرة | الرياض</title>
  <meta name="description" content="متجر نور العباية للعبايات النسائية الفاخرة في الرياض. توصيل لجميع مدن المملكة.">
  <meta property="og:title" content="نور العباية">
  <meta property="og:site_name" content="نور العباية">
  <script src="/assets/app.bundle.js"></script>
</head>
<body>
  <h1>نور العباية</h1>
  <h1>تشكيلة الصيف</h1>
  <img src="/img/hero.jpg">
  <img src="/img/abaya-1.jpg" alt="عباية سوداء كلاسيكية">
  <a href="/products/abaya-classic">عباية كلاسيكية</a>
  <a href="/products/abaya-summer">عباية صيفية</a>
</body>
</html>`;

/** صفحة منتج بـOffer بلا Product، وسعر في الوسم يخالف سعر JSON-LD. */
const PRODUCT_A = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <title>عباية كلاسيكية سوداء — نور العباية</title>
  <meta property="og:price:amount" content="349.00">
  <meta property="og:price:currency" content="SAR">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Offer",
    "price": "299.00",
    "priceCurrency": "SAR",
    "availability": "https://schema.org/InStock"
  }
  </script>
</head>
<body>
  <h1>عباية كلاسيكية سوداء</h1>
  <img src="/img/p1.jpg">
</body>
</html>`;

const PRODUCT_B = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <title>عباية صيفية — نور العباية</title>
  <meta property="og:price:amount" content="279.00">
  <meta property="og:price:currency" content="SAR">
</head>
<body>
  <h1>عباية صيفية</h1>
  <img src="/img/p2.jpg" alt="عباية صيفية بيج">
</body>
</html>`;

/** يحظر GPTBot صراحةً — وهذا ما يجعله مثالاً مفيداً. */
const ROBOTS = `User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /cart
Disallow: /checkout
Allow: /

Sitemap: https://nourabaya.sa/sitemap.xml`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://nourabaya.sa/</loc></url>
  <url><loc>https://nourabaya.sa/products/abaya-classic</loc></url>
  <url><loc>https://nourabaya.sa/products/abaya-summer</loc></url>
</urlset>`;

const HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  server: 'nginx',
  'set-cookie': 'session=abc123; Path=/',
};

function page(url: string, body: string): FetchResult {
  return { status: 200, headers: HEADERS, body, ttfbMs: 340, finalUrl: url, redirects: 0 };
}

// ── المنافسان ────────────────────────────────────────────────

/**
 * بيت الأناقة: منافس مضبوط. مخطّط منتج كامل وسعر متّسق وrobots يرحّب.
 * هو ما يجعل عمود «سبقك فيه» غير فارغ في النموذج.
 */
const RIVAL_ONE_HOME = `<!doctype html>
<html lang="ar" dir="rtl"><head>
  <title>بيت الأناقة — عبايات الرياض</title>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Organization",
   "name":"بيت الأناقة","url":"https://baitalabaya.sa"}
  </script>
</head><body>
  <h1>بيت الأناقة</h1>
  <img src="/img/hero.jpg" alt="واجهة المتجر">
  <a href="/products/abaya-royal">عباية ملكية</a>
</body></html>`;

const RIVAL_ONE_PRODUCT = `<!doctype html>
<html lang="ar" dir="rtl"><head>
  <title>عباية ملكية — بيت الأناقة</title>
  <meta property="og:price:amount" content="389.00">
  <meta property="og:price:currency" content="SAR">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"عباية ملكية",
   "brand":{"@type":"Brand","name":"بيت الأناقة"},
   "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"212"},
   "offers":{"@type":"Offer","price":"389.00","priceCurrency":"SAR",
             "availability":"https://schema.org/InStock"}}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}
  </script>
</head><body>
  <h1>عباية ملكية</h1>
  <img src="/img/royal-1.jpg" alt="عباية ملكية أمامية">
  <img src="/img/royal-2.jpg" alt="عباية ملكية خلفية">
</body></html>`;

const RIVAL_ONE_ROBOTS = `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

Sitemap: https://baitalabaya.sa/sitemap.xml
`;

/**
 * أناقتي: منافس أضعف — يحجب GPTBot وبلا مخطّط منتج.
 * وجودُه يمنع النموذج من الإيحاء بأن كل منافس متفوّق في كل شيء.
 */
const RIVAL_TWO_HOME = `<!doctype html>
<html lang="ar" dir="rtl"><head><title>أناقتي</title></head>
<body><h1>أناقتي</h1><h1>العروض</h1>
<img src="/img/a.jpg">
<a href="/products/abaya-basic">عباية بسيطة</a>
</body></html>`;

const RIVAL_TWO_PRODUCT = `<!doctype html>
<html lang="ar" dir="rtl"><head><title>عباية بسيطة — أناقتي</title></head>
<body><h1>عباية بسيطة</h1><img src="/img/b.jpg"></body></html>`;

const RIVAL_TWO_ROBOTS = `User-agent: GPTBot
Disallow: /

User-agent: *
Allow: /
`;

const PAGES: Record<string, string> = {
  [`https://${DOMAIN}/`]: HOME,
  [`https://${DOMAIN}/products/abaya-classic`]: PRODUCT_A,
  [`https://${DOMAIN}/products/abaya-summer`]: PRODUCT_B,

  'https://baitalabaya.sa/': RIVAL_ONE_HOME,
  'https://baitalabaya.sa/products/abaya-royal': RIVAL_ONE_PRODUCT,
  'https://anaqati.sa/': RIVAL_TWO_HOME,
  'https://anaqati.sa/products/abaya-basic': RIVAL_TWO_PRODUCT,
};

const TEXTS: Record<string, string> = {
  [`https://${DOMAIN}/robots.txt`]: ROBOTS,
  [`https://${DOMAIN}/sitemap.xml`]: SITEMAP,

  'https://baitalabaya.sa/robots.txt': RIVAL_ONE_ROBOTS,
  'https://anaqati.sa/robots.txt': RIVAL_TWO_ROBOTS,
};

/**
 * الأمن: شهادة تنتهي بعد 9 أيام، ونطاق بعد 22 — كلاهما يُقيَّم بالمقيّم
 * الحقيقي، فالشدّة التي تظهر في التقرير محسوبة لا مكتوبة.
 */
const SECURITY: SecurityCollected = {
  domainInfo: { expiresAt: '2026-09-19T00:00:00.000Z' },
  cert: { expiresAt: '2026-09-06T00:00:00.000Z', protocol: 'TLSv1.3' },
  mail: { spf: null, dmarc: null },
  jsAssets: [
    {
      url: `https://${DOMAIN}/assets/app.bundle.js`,
      // pk_live_ منشور عمداً (مفتاح علني) — يجب ألا يُبلَّغ عنه.
      // القيمة السرّية تُركَّب وقت التشغيل حتى لا يطابق الملف نمط سرّ في CI.
      text: `const CFG={api:"/api",stripe_pk:"pk_live_51H8sample",token:"${'sk' + '_live_' + '51QxAbCdEfGhIjKlMnOpQrStUvWxYz'}"};`,
    },
  ],
  danglingCnames: ['blog.nourabaya.sa'],
};

// ── إجابات المحرّكات — ثابتة، وموسومة كذلك ──────────────────

const ANSWER_ONE =
  'من أبرز خيارات العبايات في الرياض متجر بيت الأناقة، يتميّز بتشكيلة واسعة ' +
  'وتوصيل خلال 24 ساعة داخل المدينة. كذلك لمسة رقي معروف بجودة الأقمشة ' +
  'وسياسة إرجاع واضحة خلال 14 يوماً، ومتجر أناقتي يوفّر مقاسات متعددة ' +
  'وصفحات منتجات فيها الأسعار والتوفر بشكل مفصّل.';

const ANSWER_TWO =
  'لو تبغى سعر أرخص مع توصيل سريع، أناقتي عادةً أرخص وتبدأ عباياته من 189 ريال ' +
  'مع توصيل يومين. وبيت الأناقة أغلى شوي بس توصيله أسرع داخل الرياض.';

const ANSWERS = [ANSWER_ONE, ANSWER_TWO];

// ── التبعيات ─────────────────────────────────────────────────

let asked = 0;

const deps: PipelineDeps = {
  async fetchPage(url) {
    // الجالب الحقيقي يطبّع الرابط؛ هنا نطابق بالشكلين حتى يبقى المدخل بسيطاً.
    const body = PAGES[url] ?? PAGES[`${url}/`] ?? PAGES[url.replace(/\/$/, '')] ?? null;
    if (body === null) throw new Error(`fixture has no page for ${url}`);
    return page(url, body);
  },

  async fetchText(url) {
    return TEXTS[url] ?? null;
  },

  async askEngine() {
    const text = ANSWERS[asked % ANSWERS.length] ?? ANSWER_ONE;
    asked += 1;
    // 0.0217 دولاراً للنداء الواحد بالبحث — نفس الرقم المستعمل في التقديرات.
    return { text, citedUrls: ['https://baitalabaya.sa', 'https://anaqati.sa'], costMicros: 21_700 };
  },

  async collectSecurity() {
    return SECURITY;
  },

  llm: fakeProvider({
    scripts: [
      {
        match: /النطاق:/,
        reply: '{"category":"عبايات نسائية","city":"الرياض","brandName":"نور العباية"}',
      },
      {
        match: /العدد المطلوب/,
        reply: JSON.stringify({
          questions: [
            { text: 'وش أفضل متجر عبايات في الرياض؟', intent: 'discovery' },
            { text: 'أرخص عباية مع توصيل سريع في الرياض؟', intent: 'price' },
          ],
        }),
      },
    ],
    fallbackReply: JSON.stringify({
      competitors: [
        { name: 'بيت الأناقة', domain: 'baitalabaya.sa' },
        { name: 'لمسة رقي', domain: null },
        { name: 'أناقتي', domain: 'anaqati.sa' },
        // اسم لا يظهر في أي إجابة — الصمام يجب أن يسقطه.
        { name: 'متجر الشرق', domain: null },
      ],
    }),
  }),

  now: () => NOW,
  newId: () => 'spec-0001',
};

// ── التشغيل ──────────────────────────────────────────────────

const { result, costMicros, warnings } = await runScan(
  { url: `https://${DOMAIN}`, kind: 'full' },
  deps
);

// ── ملفّ المنافسين ───────────────────────────────────────────
//
// يُستدعى صراحةً بعد الفحص، لا داخله: زيارة كل منافس تضيف زمناً، وموضع
// تشغيلها ينتظر قياس مهلة Vercel (#9). النموذج يُظهر الشكل النهائي.

const matrix = buildMatrix(result.shareOfVoice.byEngine, 'متجرك');
const wSumAll = result.rules.reduce((a, r) => a + r.weight, 0);
const wGotAll = result.rules.reduce((a, r) => a + (r.passed ? r.weight : 0), 0);

const rivals = await profileRivals(
  matrix,
  result.rules,
  wSumAll === 0 ? 0 : Math.round((wGotAll / wSumAll) * 100),
  { fetchPage: deps.fetchPage, fetchText: deps.fetchText }
);

result.rivals = rivals;

const out = {
  generatedAt: NOW.toISOString(),
  note:
    'المدخل ثابت. النتائج (القواعد، الشدّات، حصة الصوت) محسوبة بخط الأنابيب ' +
    'الحقيقي. نصوص إجابات المحرّكات ثابتة لأنها تحتاج مفتاحاً.',
  costMicros,
  warnings,
  result,
};

writeFileSync('docs/specimen/report.json', JSON.stringify(out, null, 2) + '\n');

const passed = result.rules.filter((r) => r.passed).length;
const wSum = result.rules.reduce((a, r) => a + r.weight, 0);
const wGot = result.rules.reduce((a, r) => a + (r.passed ? r.weight : 0), 0);

console.log(`القواعد        ${passed} / ${result.rules.length} ناجحة`);
console.log(`النتيجة        ${Math.round((wGot / wSum) * 100)}%`);
console.log(`الأمن          ${result.security.length} نتيجة`);
console.log(`الإجابات       ${result.answers.length}`);
console.log(`حصة الصوت      ${result.shareOfVoice.store} / ${result.shareOfVoice.total}`);
console.log(`التكلفة        $${(costMicros / 1e6).toFixed(4)}`);
console.log(
  `المنافسون      ${rivals.profiled.length} مفحوص · ${rivals.skipped.length} متروك · سقف ${rivals.cap}`
);
for (const r of rivals.profiled) {
  console.log(
    `  ${r.name.padEnd(14)} ${String(r.score).padStart(3)}%  ` +
      `سبقك في ${r.ahead.length} · سبقتَه في ${r.behind.length}`
  );
}
if (warnings.length > 0) console.log(`تحذيرات        ${warnings.join(' · ')}`);
console.log('\n→ docs/specimen/report.json');
