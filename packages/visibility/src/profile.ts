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

const CURRENCY_SIGNS: readonly [string, RegExp][] = [
  ['SAR', /ر\.?س|ريال سعودي|"SAR"|SAR\b/],
  ['AED', /د\.?إ|درهم|"AED"/],
  ['KWD', /د\.?ك|دينار كويتي|"KWD"/],
  ['USD', /"USD"|\$\s?\d/],
  ['EUR', /"EUR"|€/],
];

const PROFILE_SYSTEM = `تقرأ صفحة متجر إلكتروني وتستخرج تخصّصه ومدينته.

أعِد JSON فقط: {"category":"...","city":"..."|null,"brandName":"..."|null}

- category: ما يبيعه المتجر بكلمات زبونه، مثل "عبايات نسائية" أو "قهوة مختصة".
- city: المدينة إن ذُكرت صراحةً، وإلا null.
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

  const currency = CURRENCY_SIGNS.find(([, sign]) => sign.test(html))?.[0] ?? null;
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
      locale,
      currency,
      productUrls: findProductUrls(html, baseUrl, sitemapXml, productLimit),
    },
    brandName,
    costMicros,
  };
}

// ── أسئلة الشراء ─────────────────────────────────────────────

const QUESTIONS_SYSTEM = `تكتب أسئلة يسألها متسوّق حقيقي للذكاء الاصطناعي قبل الشراء.

أعِد JSON فقط: {"questions":[{"text":"...","intent":"discovery|price|shipping|comparison"}]}

- اكتب بلهجة سوق المتجر المحلية، لا بالفصحى الرسمية.
- لا تذكر اسم المتجر ولا نطاقه إطلاقاً — نريد أسئلة يسألها من لا يعرفه.
- نوّع النوايا: اكتشاف، سعر، شحن، مقارنة.`;

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
  const where = profile.city === null ? '' : ` في ${profile.city}`;

  const response = await llm.complete({
    system: QUESTIONS_SYSTEM,
    user: `التخصص: ${profile.category}${where}\nاللغة: ${profile.locale}\nالعدد المطلوب: ${count}`,
    json: true,
    temperature: 0.7, // تنويع مقصود: أسئلة متطابقة تقيس شيئاً واحداً
    maxTokens: 900,
  });

  let parsed: QuestionsShape;
  try {
    parsed = parseJson<QuestionsShape>(response.text);
  } catch {
    return { questions: [], costMicros: response.costMicros };
  }

  const questions: BuyingQuestion[] = [];
  const seen = new Set<string>();

  for (const entry of parsed.questions ?? []) {
    if (typeof entry?.text !== 'string') continue;

    const text = entry.text.trim();
    if (text.length < 8 || seen.has(text)) continue;
    seen.add(text);

    const intent =
      typeof entry.intent === 'string' && (INTENTS as readonly string[]).includes(entry.intent)
        ? (entry.intent as QuestionIntent)
        : 'discovery';

    questions.push({ id: `q${questions.length + 1}`, text, intent });
    if (questions.length >= count) break;
  }

  return { questions, costMicros: response.costMicros };
}
