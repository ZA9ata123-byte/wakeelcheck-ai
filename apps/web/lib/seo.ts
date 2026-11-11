/**
 * ظهور الموقع نفسه — في Google وBing وإجابات الذكاء الاصطناعي.
 *
 * نبيع للتجّار «كن مقروءاً للوكلاء»، فأوّل متجرٍ يجتاز قواعدنا موقعنا:
 * robots.txt يرحّب بزواحف البحث المباشر بالاسم، وخريطة موقع بالصفحات
 * القابلة للفهرسة وحدها، ورابط canonical ولغات بديلة لكلّ صفحة، وبيانات
 * منظّمة بلا تقييمات — لا مراجعات حقيقية بعد، فلا نجوم.
 *
 * كلّ ما هنا بيانات خالصة، يُختبر بلا Next.
 */

import { GUIDES, guidePath } from './guides';

export const SITE = 'https://aitchek.online';

export type Lang = 'ar' | 'en';

/** الصفحات القابلة للفهرسة — المسار العربيّ والإنجليزيّ لكلّ واحدة. */
export const PAGES: readonly { ar: string; en: string; priority: number }[] = [
  { ar: '/', en: '/en', priority: 1 },
  { ar: '/guides', en: '/en/guides', priority: 0.8 },
  ...GUIDES.map((g) => ({ ar: guidePath(g.slug, 'ar'), en: guidePath(g.slug, 'en'), priority: 0.8 })),
  { ar: '/terms', en: '/en/terms', priority: 0.3 },
  { ar: '/privacy', en: '/en/privacy', priority: 0.3 },
  { ar: '/refund', en: '/en/refund', priority: 0.3 },
];

const abs = (path: string): string => `${SITE}${path === '/' ? '' : path}` || SITE;

/** canonical ولغات بديلة لصفحةٍ بمسارها في اللغتين. العربية هي الافتراضية. */
export function alternatesFor(page: { ar: string; en: string }, lang: Lang) {
  return {
    canonical: abs(lang === 'ar' ? page.ar : page.en),
    languages: { ar: abs(page.ar), en: abs(page.en), 'x-default': abs(page.ar) },
  };
}

/**
 * زواحف البحث المباشر تُذكر بالاسم مرحَّباً بها — هي ما يقرّر الظهور في
 * الإجابات. وزواحف التدريب لا تُمنع: لا ضرر في أن يعرفنا النموذج.
 */
export const WELCOMED_BOTS: readonly string[] = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Googlebot',
  'Bingbot',
  'PerplexityBot',
  'Claude-SearchBot',
  'Claude-User',
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
];

/** ما لا يُفهرس: واجهات البرمجة — لا محتوى فيها لقارئ. */
export const DISALLOWED: readonly string[] = ['/api/'];

export function robotsRules() {
  return {
    rules: [
      ...WELCOMED_BOTS.map((userAgent) => ({ userAgent, allow: '/', disallow: [...DISALLOWED] })),
      { userAgent: '*', allow: '/', disallow: [...DISALLOWED] },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}

export function sitemapEntries(now: Date) {
  return PAGES.flatMap((page) =>
    (['ar', 'en'] as const).map((lang) => ({
      url: abs(lang === 'ar' ? page.ar : page.en),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: page.priority,
      alternates: { languages: { ar: abs(page.ar), en: abs(page.en) } },
    }))
  );
}

const DESCRIPTION: Record<Lang, string> = {
  ar: 'وكيل تشيك يُري التاجر الإجابة الحرفية التي يعطيها ChatGPT وGoogle AI Mode لزبونه، ومن ذُكر بدلاً منه، والسبب التقني، والإصلاح. فحص مجاني، ومتابعة أسبوعية بـ39 دولاراً شهرياً.',
  en: 'WakeelCheck shows online stores the verbatim answer ChatGPT and Google AI Mode give their customers, who is named instead of them, the technical cause, and the fix. Free scan; weekly monitoring at $39/month.',
};

/**
 * Organization وWebSite وSoftwareApplication — بلا AggregateRating ولا
 * FAQ ولا HowTo: لا مراجعات حقيقية بعد، وGoogle قلّص الأخيرين.
 */
export function jsonLd(lang: Lang) {
  const url = abs(lang === 'ar' ? '/' : '/en');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE}/#org`,
        name: 'WakeelCheck',
        alternateName: ['وكيل تشيك', 'AITCHEK'],
        url: SITE,
        logo: `${SITE}/brand/mark.svg`,
        email: 'support@aitchek.online',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#site`,
        url: SITE,
        name: lang === 'ar' ? 'وكيل تشيك' : 'WakeelCheck',
        inLanguage: ['ar', 'en'],
        publisher: { '@id': `${SITE}/#org` },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'WakeelCheck',
        url,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: lang,
        description: DESCRIPTION[lang],
        publisher: { '@id': `${SITE}/#org` },
        offers: [
          { '@type': 'Offer', name: lang === 'ar' ? 'الفحص المجاني' : 'Free scan', price: '0', priceCurrency: 'USD' },
          {
            '@type': 'Offer',
            name: lang === 'ar' ? 'المتابعة الأسبوعية' : 'Weekly monitoring',
            price: '39',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '39',
              priceCurrency: 'USD',
              billingDuration: 'P1M',
            },
          },
        ],
      },
    ],
  };
}

export const SEO_DESCRIPTION = DESCRIPTION;
