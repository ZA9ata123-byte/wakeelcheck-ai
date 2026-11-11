import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, SITE, alternatesFor, jsonLd, robotsRules, sitemapEntries } from '../lib/seo';

/**
 * موقعنا أوّل من يجتاز قواعدنا: زواحف البحث المباشر مرحَّبٌ بها بالاسم،
 * والخريطة بالصفحات القابلة للفهرسة وحدها، ولا نجوم بلا مراجعات.
 */

test('زواحف البحث المباشر مرحَّبٌ بها بالاسم، ولا يُحظر منها شيء', () => {
  const { rules, sitemap } = robotsRules();
  for (const bot of ['OAI-SearchBot', 'Googlebot', 'Bingbot', 'PerplexityBot', 'Claude-SearchBot']) {
    const r = rules.find((x) => x.userAgent === bot);
    assert.ok(r, bot);
    assert.equal(r.allow, '/');
    assert.ok(!r.disallow.includes('/'), `${bot} is not blocked`);
  }
  assert.equal(sitemap, `${SITE}/sitemap.xml`);
});

test('واجهات البرمجة خارج الفهرسة، والصفحات داخلها', () => {
  const star = robotsRules().rules.find((r) => r.userAgent === '*');
  assert.deepEqual(star?.disallow, ['/api/']);
});

test('الخريطة: كلّ صفحة بلغتيها، بلا /api ولا تكرار', () => {
  const urls = sitemapEntries(new Date('2026-11-11T00:00:00Z')).map((e) => e.url);
  assert.equal(urls.length, PAGES.length * 2);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.includes(SITE));
  assert.ok(urls.includes(`${SITE}/en`));
  assert.ok(urls.every((u) => u.startsWith(SITE) && !u.includes('/api')));
});

test('canonical لكلّ لغة، والعربية افتراضية', () => {
  const ar = alternatesFor({ ar: '/terms', en: '/en/terms' }, 'ar');
  const en = alternatesFor({ ar: '/terms', en: '/en/terms' }, 'en');
  assert.equal(ar.canonical, `${SITE}/terms`);
  assert.equal(en.canonical, `${SITE}/en/terms`);
  assert.equal(en.languages['x-default'], `${SITE}/terms`);
});

test('البيانات المنظّمة: السعر الحقيقي، ولا تقييمات ولا FAQ ولا HowTo', () => {
  const text = JSON.stringify(jsonLd('ar'));
  assert.match(text, /"price":"39"/);
  assert.doesNotMatch(text, /AggregateRating|Review|FAQPage|HowTo/);
});

test('الأدلة في الخريطة بلغتيها، وكلّ دليلٍ بجوابٍ ومصادر', async () => {
  const { GUIDES, guidePath } = await import('../lib/guides');
  const urls = sitemapEntries(new Date()).map((e) => e.url);
  for (const g of GUIDES) {
    assert.ok(urls.includes(`${SITE}${guidePath(g.slug, 'ar')}`), g.slug);
    assert.ok(urls.includes(`${SITE}${guidePath(g.slug, 'en')}`), g.slug);
    for (const lang of ['ar', 'en'] as const) {
      assert.ok(g[lang].answer.length > 80, 'الجواب في أوّل الصفحة');
      assert.ok(g[lang].answer.split(/\s+/).length <= 90, 'جوابٌ يُقتبس، لا مقالة');
    }
    assert.ok(g.sources.length > 0 && g.sources.every((s) => s.url.startsWith('https://')));
  }
});
