/**
 * توصيف المتجر وتوليد أسئلة الشراء.
 *
 * التوصيف يبدأ باستدلالات مجانية (المنصة، العملة، اللغة، روابط المنتجات)
 * ولا يستدعي النموذج إلا لما لا يُستنتج من الوسوم: تخصص المتجر ومدينته.
 */

import * as cheerio from 'cheerio';
import type { BuyingQuestion, Platform, QuestionIntent, StoreProfile } from '@wakeelcheck/core';
import { parseJson, type LlmProvider } from '@wakeelcheck/llm';

// ── بصمات المنصات ────────────────────────────────────────────

const PLATFORM_SIGNS: readonly [Platform, RegExp][] = [
  ['salla', /salla\.(sa|network|dev)|window\.Salla|cdn\.salla/i],
  ['zid', /zid\.(sa|store)|cdn\.zid|window\.zid/i],
  ['shopify', /cdn\.shopify\.com|myshopify\.com|Shopify\.theme/i],
  ['woocommerce', /woocommerce|wp-content\/plugins\/woocommerce|wc-ajax/i],
  ['magento', /Magento_|mage\/|static\/version\d+\/frontend/i],
];

export function detectPlatform(html: string): Platform {
  for (const [platform, sign] of PLATFORM_SIGNS) {
    if (sign.test(html)) return platform;
  }
  return 'custom';
}

// ── روابط المنتجات ───────────────────────────────────────────

const PRODUCT_PATH = /\/(product|products|p|item|shop)\/[^/?#]+/i;

/**
 * يجمع روابط منتجات من الصفحة وخريطة الموقع.
 *
 * هذا ما يجعل الإصلاح الثاني ممكناً: قواعد المنتج تحتاج صفحات منتجات
 * فعلية، ولا يصحّ تقييمها على الرئيسية.
 */
export function findProductUrls(
  html: string,
  baseUrl: string,
  sitemapXml: string | null,
  limit = 5
): string[] {
  const found = new Set<string>();

  const push = (raw: string): void => {
    if (found.size >= limit) return;
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      if (new URL(baseUrl).hostname !== url.hostname) return; // نطاقنا فقط
      if (!PRODUCT_PATH.test(url.pathname)) return;
      url.hash = '';
      found.add(url.toString());
    } catch {
      // رابط معطوب — نتجاهله
    }
  };

  // خريطة الموقع أدقّ من روابط الصفحة: مقصودة للفهرسة لا للتنقّل.
  if (sitemapXml !== null) {
    for (const match of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      push(match[1] ?? '');
    }
  }

  if (found.size < limit) {
    const $ = cheerio.load(html || '<html></html>');
    $('a[href]').each((_i, el) => {
      push($(el).attr('href') ?? '');
    });
  }

  return [...found].slice(0, limit);
}

// ── التوصيف ──────────────────────────────────────────────────

// ── العملة والبلد ─────────────────────────────────────────────
//
// `\b` لا يعمل مع العربية (L-004): «ر.?س» بلا حدودٍ طابق «مدارس» و«فارس»،
// فقُرئ متجرٌ كويتيّ سعودياً وسُئل عن الرياض. الرموز العربية تُطابَق هنا
// بشرط ألّا يجاورها حرفٌ عربيّ، والدليل البنيويّ (`priceCurrency`) أوّلاً.

const AR = '؀-ۿ';
const solo = (core: string): RegExp => new RegExp(`(?<![${AR}])(?:${core})(?![${AR}])`);

const CURRENCY_STRUCTURED =
  /"(?:priceCurrency|currency|currency_code|currencyCode)"\s*:\s*"([A-Z]{3})"|product:price:currency"\s+content="([A-Z]{3})"/;

const CURRENCY_SIGNS: readonly [string, RegExp][] = [
  ['KWD', solo(String.raw`د\.?\s?ك|دينار كويتي`)],
  ['SAR', solo(String.raw`ر\.?\s?س|ريال سعودي`)],
  ['AED', solo(String.raw`د\.?\s?إ|درهم إماراتي`)],
  ['QAR', solo(String.raw`ر\.?\s?ق|ريال قطري`)],
  ['BHD', solo(String.raw`د\.?\s?ب|دينار بحريني`)],
  ['OMR', solo(String.raw`ر\.?\s?ع|ريال عماني|ريال عُماني`)],
  ['MAD', solo(String.raw`د\.?\s?م|درهم مغربي`)],
  ['KWD', /\bKWD\b/],
  ['SAR', /\bSAR\b/],
  ['AED', /\bAED\b/],
  ['USD', /\bUSD\b|\$\s?\d/],
  ['EUR', /\bEUR\b|€/],
];

export function detectCurrency(html: string): string | null {
  const m = CURRENCY_STRUCTURED.exec(html);
  const structured = m?.[1] ?? m?.[2];
  if (structured !== undefined) return structured;
  return CURRENCY_SIGNS.find(([, sign]) => sign.test(html))?.[0] ?? null;
}

interface Country {
  code: string;
  ar: string;
  phone: string;
  currency: string;
}

const COUNTRIES: readonly Country[] = [
  { code: 'kw', ar: 'الكويت', phone: '965', currency: 'KWD' },
  { code: 'sa', ar: 'السعودية', phone: '966', currency: 'SAR' },
  { code: 'ae', ar: 'الإمارات', phone: '971', currency: 'AED' },
  { code: 'qa', ar: 'قطر', phone: '974', currency: 'QAR' },
  { code: 'bh', ar: 'البحرين', phone: '973', currency: 'BHD' },
  { code: 'om', ar: 'عُمان', phone: '968', currency: 'OMR' },
  { code: 'ma', ar: 'المغرب', phone: '212', currency: 'MAD' },
  { code: 'jo', ar: 'الأردن', phone: '962', currency: 'JOD' },
  { code: 'eg', ar: 'مصر', phone: '20', currency: 'EGP' },
];

/** «الكويت» ← «kw». */
export function countryCode(country: string | null): string | null {
  return COUNTRIES.find((c) => c.ar === country)?.code ?? null;
}

/**
 * لغة الصفحة ببلد المتجر: «ar» + الكويت ← «ar-KW».
 *
 * البلد يغلب منطقة اللغة: صفحةٌ بـ`lang="ar-SA"` ورقمٍ كويتيّ متجرٌ كويتيّ.
 * المحرّكات تقرأ المنطقة لتسأل من البلد الصحيح — Google في الكويت لا يجيب
 * كما يجيب في الرياض.
 */
export function regionalLocale(locale: string, country: string | null): string {
  const code = countryCode(country);
  if (code === null) return locale;
  const lang = locale.split(/[-_]/)[0] || 'ar';
  return `${lang}-${code.toUpperCase()}`;
}

/**
 * البلد من أدلّة الصفحة، بالترتيب: نطاق البلد (‎.kw)، ثم رقم الهاتف أو
 * واتساب (+965)، ثم لغة الصفحة (ar-KW)، ثم العملة. الهاتف قبل العملة: متجرٌ
 * كويتيّ قد يعرض الريال لزبائنه في السعودية، ورقمه يبقى كويتياً.
 */
export function detectCountry(html: string, domain: string, lang: string | null, currency: string | null): string | null {
  const host = domain.toLowerCase();
  const byTld = COUNTRIES.find((c) => host.endsWith(`.${c.code}`));
  if (byTld !== undefined) return byTld.ar;

  let best: { c: Country; n: number } | null = null;
  for (const c of COUNTRIES) {
    // مصر (+20) بلا تكملةٍ صارمة تطابق أيّ رقم: تُشترط صيغة الجوال المصريّ.
    const tail = c.phone === '20' ? String.raw`1\d{9}` : String.raw`\d{7,9}`;
    const re = new RegExp(String.raw`(?:\+|%2B|00|wa\.me/|phone=)\s?${c.phone}[\s-]?${tail}`, 'g');
    const n = html.match(re)?.length ?? 0;
    if (n > 0 && (best === null || n > best.n)) best = { c, n };
  }
  if (best !== null) return best.c.ar;

  const region = lang?.split(/[-_]/)[1]?.toLowerCase();
  const byLang = COUNTRIES.find((c) => c.code === region);
  if (byLang !== undefined) return byLang.ar;

  return COUNTRIES.find((c) => c.currency === currency)?.ar ?? null;
}

const PROFILE_SYSTEM = `تقرأ صفحة متجر إلكتروني وتستخرج تخصّصه ومدينته.

أعِد JSON فقط: {"category":"...","city":"..."|null,"brandName":"..."|null}

- category: ما يبيعه المتجر بكلمات زبونه، مثل "عبايات نسائية" أو "قهوة مختصة".
- city: المدينة إن ذُكرت صراحةً في الصفحة، وإلا null. لا تستنتجها من العملة ولا من اللغة.
- brandName: اسم المتجر كما يكتبه هو، وإلا null.`;

export interface ProfileResult {
  profile: StoreProfile;
  brandName: string | null;
  costMicros: number;
}

interface ProfileShape {
  category?: unknown;
  city?: unknown;
  brandName?: unknown;
}

export async function buildProfile(
  html: string,
  domain: string,
  baseUrl: string,
  sitemapXml: string | null,
  llm: LlmProvider,
  productLimit = 5
): Promise<ProfileResult> {
  const $ = cheerio.load(html || '<html></html>');

  const currency = detectCurrency(html);
  const lang = $('html').attr('lang')?.trim();
  const locale = lang !== undefined && lang.length >= 2 ? lang : 'ar-SA';

  // مقتطف مركّز بدل الصفحة كاملة: أرخص، وأدقّ لأن الضجيج أقل.
  const excerpt = [
    $('title').text(),
    $('meta[name="description"]').attr('content') ?? '',
    $('meta[property="og:site_name"]').attr('content') ?? '',
    $('h1').first().text(),
    $('h2').slice(0, 4).text(),
  ]
    .join('\n')
    .replace(/\s+/g, ' ')
    .slice(0, 1200);

  let category = 'متجر إلكتروني';
  let city: string | null = null;
  let brandName: string | null = null;
  let costMicros = 0;

  try {
    const response = await llm.complete({
      system: PROFILE_SYSTEM,
      user: `النطاق: ${domain}\n${excerpt}`,
      json: true,
      temperature: 0,
      maxTokens: 300,
    });
    costMicros = response.costMicros;

    const parsed = parseJson<ProfileShape>(response.text);
    if (typeof parsed.category === 'string' && parsed.category.trim().length > 0) {
      category = parsed.category.trim();
    }
    if (typeof parsed.city === 'string' && parsed.city.trim().length > 0) {
      city = parsed.city.trim();
    }
    if (typeof parsed.brandName === 'string' && parsed.brandName.trim().length > 0) {
      brandName = parsed.brandName.trim();
    }
  } catch {
    // فشل التوصيف لا يُسقط الفحص — نكمل بالاستدلالات المجانية.
  }

  return {
    profile: {
      domain,
      platform: detectPlatform(html),
      category,
      city,
      country: detectCountry(html, domain, lang ?? null, currency),
      locale,
      currency,
      productUrls: findProductUrls(html, baseUrl, sitemapXml, productLimit),
    },
    brandName,
    costMicros,
  };
}

// ── أسئلة الشراء ─────────────────────────────────────────────

const QUESTIONS_SYSTEM = `تكتب أسئلة يسألها متسوّق حقيقي لمساعد ذكاء اصطناعي (مثل ChatGPT) قبل الشراء.

أعِد JSON فقط: {"questions":[{"text":"...","intent":"discovery|price|shipping|comparison"}]}

- المتسوّق لا يعرف المتجر بعد. يسأل المساعد من أين يشتري وأيّ متجر يرشّح — كلّ سؤال يطلب ترشيح متاجر أو مكان شراء.
  أمثلة: «وين ألقى عبايات سوداء ناعمة بالكويت؟» · «وش أفضل متجر أونلاين للعطور النسائية؟» · "Where can I buy modest dresses online in Kuwait?"
- لا يخاطب المتسوّق متجراً ولا بائعاً: لا «عندكم» ولا «هل لديكم» ولا "do you have" ولا "your sizes". هذا سؤالٌ لبائع، والمساعد يجيب عنه متقمّصاً المتجر فلا يقيس شيئاً.
- اذكر التخصص، والبلد المعطى. لا تذكر مدينةً ولا بلداً غير المعطى: متجرٌ في الكويت لا يُسأل عنه في الرياض.
- اكتب باللغة المعطاة. بالعربية: بلهجة سوق المتجر المحلية، لا بالفصحى الرسمية.
- لا تذكر اسم المتجر ولا نطاقه إطلاقاً — نريد أسئلة يسألها من لا يعرفه.
- نوّع النوايا: اكتشاف، سعر، شحن، مقارنة.`;

/**
 * سؤالٌ يخاطب البائع لا المساعد — «عندكم المقاس؟»، "Do you have it in plus?".
 *
 * ChatGPT يجيب عنه متقمّصاً المتجر («نعم، لدينا…») فلا يُرشّح أحداً ولا
 * يقيس ظهور أحد. حدث فعلاً على أوّل فحصٍ حيّ. يُحذف مهما التزم النموذج.
 *
 * العربية بـ`includes`: `\b` لا يعمل معها (L-004)، وصيغ الجمع هذه لا تقع
 * داخل كلماتٍ أخرى.
 */
const SELLER_EN =
  /\b(do|does|can|could|will|would) you (have|sell|offer|ship|deliver|carry|stock|make)\b|\byour (store|shop|stock|sizes?|products?|collection|prices?|items?)\b/i;
const SELLER_AR = ['عندكم', 'لديكم', 'تبيعون', 'توفرون', 'توفّرون', 'توصلون', 'توصّلون', 'تشحنون', 'متجركم', 'منتجاتكم', 'أسعاركم', 'اسعاركم', 'مقاساتكم'];

export function addressesSeller(text: string): boolean {
  return SELLER_EN.test(text) || SELLER_AR.some((w) => text.includes(w));
}

/** السؤال الذي لا يخطئ: إن لم يبقَ من أسئلة النموذج شيءٌ صالح. */
export function fallbackQuestion(profile: StoreProfile): BuyingQuestion {
  const english = profile.locale.toLowerCase().startsWith('en');
  const place = profile.city ?? profile.country;
  const text = english
    ? `What is the best online store for ${profile.category}${place === null ? '' : ` in ${place}`}?`
    : `وش أفضل متجر أونلاين لـ${profile.category}${place === null ? '' : ` في ${place}`}؟`;
  return { id: 'q1', text, intent: 'discovery' };
}

const INTENTS: readonly QuestionIntent[] = ['discovery', 'price', 'shipping', 'comparison'];

interface QuestionsShape {
  questions?: { text?: unknown; intent?: unknown }[];
}

export interface QuestionsResult {
  questions: BuyingQuestion[];
  costMicros: number;
}

export async function generateQuestions(
  profile: StoreProfile,
  count: number,
  llm: LlmProvider
): Promise<QuestionsResult> {
  const response = await llm.complete({
    system: QUESTIONS_SYSTEM,
    user: [
      `التخصص: ${profile.category}`,
      `البلد: ${profile.country ?? 'غير معروف — لا تذكر بلداً ولا مدينة'}`,
      `المدينة: ${profile.city ?? 'غير معروفة — لا تخترع مدينة'}`,
      `اللغة: ${profile.locale}`,
      `العدد المطلوب: ${count}`,
    ].join('\n'),
    json: true,
    temperature: 0.7, // تنويع مقصود: أسئلة متطابقة تقيس شيئاً واحداً
    maxTokens: 900,
  });

  let parsed: QuestionsShape;
  try {
    parsed = parseJson<QuestionsShape>(response.text);
  } catch {
    return { questions: [fallbackQuestion(profile)], costMicros: response.costMicros };
  }

  const questions: BuyingQuestion[] = [];
  const seen = new Set<string>();

  for (const entry of parsed.questions ?? []) {
    if (typeof entry?.text !== 'string') continue;

    const text = entry.text.trim();
    if (text.length < 8 || seen.has(text) || addressesSeller(text)) continue;
    seen.add(text);

    const intent =
      typeof entry.intent === 'string' && (INTENTS as readonly string[]).includes(entry.intent)
        ? (entry.intent as QuestionIntent)
        : 'discovery';

    questions.push({ id: `q${questions.length + 1}`, text, intent });
    if (questions.length >= count) break;
  }

  if (questions.length === 0) questions.push(fallbackQuestion(profile));

  return { questions, costMicros: response.costMicros };
}
