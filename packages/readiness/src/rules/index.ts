/**
 * القواعد الفعّالة.
 *
 * نطاق الإطلاق مقصود: القواعد التي لها إصلاح حقيقي وأثر مباشر على ظهور
 * المتجر أمام الوكلاء. البقية تُضاف لاحقاً — قاعدة بلا إصلاح تُنتج ضجيجاً
 * في التقرير ولا تُنتج قيمة للتاجر.
 */

import type { Rule, ScanContext } from '../context.ts';
import { result } from '../context.ts';
import { isAllowed, isNamed } from '../robots.ts';
import { readPage, samePrice, type PageFacts } from '../jsonld.ts';

/** يقيّم على صفحات المنتجات، ويسقط إلى الرئيسية إن لم تُكتشف صفحات. */
function productFacts(ctx: ScanContext): { facts: PageFacts[]; onHome: boolean } {
  if (ctx.products.length > 0) {
    return { facts: ctx.products.map(readPage), onHome: false };
  }
  return { facts: [readPage(ctx.home)], onHome: true };
}

function where(onHome: boolean, count: number): string {
  return onHome ? 'homepage (no product pages found)' : `${count} product page(s)`;
}

// ── الوصول: هل يستطيع الوكيل قراءة المتجر أصلاً؟ ──────────────

interface BotSpec {
  key: string;
  agent: string;
  label: string;
  weight: number;
}

const BOTS: readonly BotSpec[] = [
  { key: 'robots.gptbot', agent: 'GPTBot', label: 'ChatGPT', weight: 10 },
  { key: 'robots.oai_searchbot', agent: 'OAI-SearchBot', label: 'ChatGPT Search', weight: 9 },
  { key: 'robots.perplexitybot', agent: 'PerplexityBot', label: 'Perplexity', weight: 8 },
  { key: 'robots.google_extended', agent: 'Google-Extended', label: 'Gemini', weight: 9 },
  { key: 'robots.claudebot', agent: 'ClaudeBot', label: 'Claude', weight: 7 },
];

const botRules: Rule[] = BOTS.map(({ key, agent, label, weight }) => ({
  key,
  weight,
  active: true,
  evaluate(ctx) {
    const allowed = isAllowed(ctx.robots, agent, '/');
    const named = isNamed(ctx.robots, agent);

    const state = allowed ? (named ? 'welcomed' : 'allowed by default') : 'blocked';

    return result(
      allowed,
      {
        ar: allowed
          ? named
            ? `${label} مسموح له صراحةً بقراءة متجرك`
            : `${label} غير محظور — لكن متجرك لا يذكره صراحةً`
          : `${label} محظور في robots.txt — لن يرى متجرك إطلاقاً`,
        en: allowed
          ? named
            ? `${label} is explicitly welcomed`
            : `${label} is not blocked, though never named`
          : `${label} is blocked in robots.txt`,
      },
      `User-agent: ${agent} → ${state}`,
      allowed ? undefined : `User-agent: ${agent}\nAllow: /`
    );
  },
}));

const robotsFile: Rule = {
  key: 'robots.file',
  weight: 6,
  active: true,
  evaluate(ctx) {
    const has = ctx.robots.hasDirectives;
    return result(
      has,
      {
        ar: has ? 'ملف robots.txt موجود ومقروء' : 'ملف robots.txt مفقود',
        en: has ? 'robots.txt is present' : 'robots.txt is missing',
      },
      has ? `${ctx.robots.groups.length} group(s)` : 'GET /robots.txt → not found',
      has ? undefined : 'User-agent: *\nAllow: /\n\nSitemap: https://DOMAIN/sitemap.xml'
    );
  },
};

const sitemapListed: Rule = {
  key: 'robots.sitemap_listed',
  weight: 5,
  active: true,
  evaluate(ctx) {
    const listed = ctx.robots.sitemaps.length > 0;
    return result(
      listed,
      {
        ar: listed ? 'خريطة الموقع مذكورة في robots.txt' : 'خريطة الموقع غير مذكورة في robots.txt',
        en: listed ? 'Sitemap declared in robots.txt' : 'Sitemap not declared in robots.txt',
      },
      listed ? (ctx.robots.sitemaps[0] as string) : 'no Sitemap: directive',
      listed ? undefined : `Sitemap: https://${ctx.domain}/sitemap.xml`
    );
  },
};

// ── الفهم: هل تستطيع الآلة قراءة المنتج؟ ─────────────────────

interface SchemaSpec {
  key: string;
  type: string;
  weight: number;
  ar: string;
  en: string;
}

const PRODUCT_SCHEMAS: readonly SchemaSpec[] = [
  { key: 'schema.product', type: 'product', weight: 10, ar: 'مخطط المنتج', en: 'Product schema' },
  { key: 'schema.offer', type: 'offer', weight: 10, ar: 'مخطط العرض والسعر', en: 'Offer schema' },
  {
    key: 'schema.rating',
    type: 'aggregaterating',
    weight: 7,
    ar: 'مخطط التقييمات',
    en: 'AggregateRating schema',
  },
  { key: 'schema.brand', type: 'brand', weight: 5, ar: 'مخطط العلامة', en: 'Brand schema' },
];

const productSchemaRules: Rule[] = PRODUCT_SCHEMAS.map(({ key, type, weight, ar, en }) => ({
  key,
  weight,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);
    const hits = facts.filter((f) => f.types.has(type)).length;
    const passed = hits > 0 && !onHome;

    return result(
      passed,
      {
        ar: passed
          ? `${ar} موجود في صفحات منتجاتك`
          : onHome
            ? `لم نعثر على صفحات منتجات لفحص ${ar}`
            : `${ar} مفقود في صفحات المنتجات`,
        en: passed
          ? `${en} found on product pages`
          : onHome
            ? `No product pages found to check ${en}`
            : `${en} missing from product pages`,
      },
      `${hits}/${facts.length} of ${where(onHome, facts.length)} carry @type ${type}`
    );
  },
}));

const siteSchemaRules: Rule[] = (
  [
    ['schema.organization', 'organization', 7, 'هوية المتجر', 'Organization schema'],
    ['schema.breadcrumb', 'breadcrumblist', 5, 'مسار التصفح', 'BreadcrumbList schema'],
  ] as const
).map(([key, type, weight, ar, en]) => ({
  key,
  weight,
  active: true,
  evaluate(ctx: ScanContext) {
    const pages = [readPage(ctx.home), ...ctx.products.map(readPage)];
    const passed = pages.some((p) => p.types.has(type));

    return result(
      passed,
      {
        ar: passed ? `${ar} معرّف برمجياً` : `${ar} غير معرّف`,
        en: passed ? `${en} present` : `${en} missing`,
      },
      passed ? `@type ${type} found` : `@type ${type} not found on ${pages.length} page(s)`
    );
  },
}));

// ── الاتساق: هل تتناقض طبقات البيانات؟ ───────────────────────

const priceConsistency: Rule = {
  key: 'consistency.price',
  weight: 9,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);

    // سعر غائب تماماً ليس «اتساقاً». الاكتفاء بمقارنة القيم يجعل متجراً
    // بلا أي سعر يجتاز القاعدة — وهي بالضبط فئة القواعد التي تنجح دائماً
    // فتضخّم النتيجة بلا أن تقيس شيئاً.
    const withPrice = facts.filter(
      (f) => f.price.schema !== null || f.price.openGraph !== null || f.price.microdata !== null
    );

    const conflicts = withPrice.filter(
      (f) =>
        !samePrice(f.price.schema, f.price.openGraph) ||
        !samePrice(f.price.schema, f.price.microdata)
    );
    const passed = withPrice.length > 0 && conflicts.length === 0;

    const sample = facts[0];
    const evidence =
      sample === undefined
        ? 'no pages'
        : `schema=${sample.price.schema ?? '—'} og=${sample.price.openGraph ?? '—'} ` +
          `microdata=${sample.price.microdata ?? '—'}`;

    return result(
      passed,
      {
        ar: passed
          ? 'الأسعار متطابقة بين Schema و OpenGraph و HTML'
          : withPrice.length === 0
            ? 'لا يوجد سعر مهيكل إطلاقاً — الوكيل لا يستطيع قراءة أسعارك'
            : `تناقض في السعر بين الطبقات في ${conflicts.length} صفحة — الوكلاء يستبعدون المتاجر المتناقضة`,
        en: passed
          ? 'Price matches across Schema, OpenGraph and HTML'
          : withPrice.length === 0
            ? 'No structured price at all — agents cannot read your prices'
            : `Price disagrees across layers on ${conflicts.length} page(s)`,
      },
      `${where(onHome, facts.length)} — ${evidence}`,
      withPrice.length === 0 ? '"offers": { "@type": "Offer", "price": "299.00" }' : undefined
    );
  },
};

const availabilityDeclared: Rule = {
  key: 'consistency.availability',
  weight: 7,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);
    const declared = facts.filter(
      (f) => f.availability.schema !== null || f.availability.openGraph !== null
    ).length;
    const passed = declared > 0;

    return result(
      passed,
      {
        ar: passed
          ? 'حالة التوفر معلنة برمجياً'
          : 'حالة التوفر (InStock) غير معلنة — الوكيل لا يعرف إن كان المنتج متاحاً',
        en: passed ? 'Availability is declared' : 'Availability is not declared',
      },
      `${declared}/${facts.length} of ${where(onHome, facts.length)} declare availability`,
      passed ? undefined : '"availability": "https://schema.org/InStock"'
    );
  },
};

const currencyDeclared: Rule = {
  key: 'consistency.currency',
  weight: 6,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);
    const declared = facts.filter(
      (f) => f.currency.schema !== null || f.currency.openGraph !== null
    ).length;
    const passed = declared > 0;

    return result(
      passed,
      {
        ar: passed ? 'العملة معلنة برمجياً' : 'العملة غير معلنة — السعر بلا عملة لا معنى له للوكيل',
        en: passed ? 'Currency is declared' : 'Currency is not declared',
      },
      `${declared}/${facts.length} of ${where(onHome, facts.length)} declare currency`,
      passed ? undefined : '"priceCurrency": "SAR"'
    );
  },
};

// ── الملفات المقروءة آلياً ───────────────────────────────────

const sitemapReachable: Rule = {
  key: 'machine.sitemap',
  weight: 6,
  active: true,
  evaluate(ctx) {
    return result(
      ctx.sitemapFound,
      {
        ar: ctx.sitemapFound ? 'خريطة الموقع متاحة' : 'خريطة الموقع sitemap.xml غير متاحة',
        en: ctx.sitemapFound ? 'sitemap.xml is reachable' : 'sitemap.xml is not reachable',
      },
      `HEAD https://${ctx.domain}/sitemap.xml → ${ctx.sitemapFound ? '200' : 'not found'}`
    );
  },
};

const llmsTxt: Rule = {
  key: 'machine.llms_txt',
  // وزن منخفض عن قصد: Google صرّحت أنها لا تستعمله، ولا شركة كبرى التزمت
  // بقراءته في الإنتاج. مفيد لبعض الوكلاء، لكنه ليس معياراً حاسماً.
  weight: 3,
  active: true,
  evaluate(ctx) {
    const text = ctx.llmsTxt;
    const rich = text !== null && text.trim().length > 100;

    return result(
      rich,
      {
        ar: rich ? 'ملف llms.txt موجود وغني بالمحتوى' : 'ملف llms.txt مفقود أو شبه فارغ',
        en: rich ? 'llms.txt present and substantive' : 'llms.txt missing or thin',
      },
      text === null ? 'GET /llms.txt → not found' : `${text.length} chars`
    );
  },
};

// ── البنية الدلالية ──────────────────────────────────────────

const singleH1: Rule = {
  key: 'semantic.single_h1',
  weight: 5,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);
    const bad = facts.filter((f) => f.h1Count !== 1).length;
    const passed = bad === 0;

    return result(
      passed,
      {
        ar: passed ? 'كل صفحة تحمل عنواناً رئيسياً واحداً' : `${bad} صفحة بعنوان H1 مكرر أو مفقود`,
        en: passed ? 'Every page has exactly one H1' : `${bad} page(s) with a wrong H1 count`,
      },
      `${where(onHome, facts.length)} — h1 counts: ${facts.map((f) => f.h1Count).join(', ')}`
    );
  },
};

const imageAlt: Rule = {
  key: 'semantic.image_alt',
  weight: 5,
  active: true,
  evaluate(ctx) {
    const { facts, onHome } = productFacts(ctx);

    const total = facts.reduce((sum, f) => sum + f.imageCount, 0);
    const withAlt = facts.reduce((sum, f) => sum + f.imagesWithAlt, 0);
    const ratio = total === 0 ? 0 : withAlt / total;
    const passed = total > 0 && ratio >= 0.8;

    return result(
      passed,
      {
        ar:
          total === 0
            ? 'لم نعثر على صور لفحصها'
            : `${Math.round(ratio * 100)}% من الصور تحمل نصاً بديلاً — الوكيل يقرأ الصور عبره`,
        en:
          total === 0
            ? 'No images found'
            : `${Math.round(ratio * 100)}% of images carry alt text`,
      },
      `${withAlt}/${total} images on ${where(onHome, facts.length)}`
    );
  },
};

export const ACTIVE_RULES: readonly Rule[] = [
  robotsFile,
  ...botRules,
  sitemapListed,
  ...productSchemaRules,
  ...siteSchemaRules,
  priceConsistency,
  availabilityDeclared,
  currencyDeclared,
  sitemapReachable,
  llmsTxt,
  singleH1,
  imageAlt,
];
