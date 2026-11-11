/**
 * دليلٌ واحد: الجواب أولاً، ثم الخطوات، ثم المصادر — وبيانات Article منظّمة.
 * بلا JavaScript: ما يقرؤه الزاحف هو ما يراه القارئ.
 */

import { SiteFooter, SiteHeader, homeOf } from '@/components/Chrome';
import { SITE } from '@/lib/seo';
import { guidePath, type Guide } from '@/lib/guides';

type Lang = 'ar' | 'en';

const T = {
  ar: { short: 'الجواب باختصار', sources: 'المصادر', updated: 'آخر تحديث', cta: 'افحص متجرك مجاناً', guides: 'كلّ الأدلة' },
  en: { short: 'The short answer', sources: 'Sources', updated: 'Last updated', cta: 'Scan your store for free', guides: 'All guides' },
} as const;

export function articleJsonLd(guide: Guide, lang: Lang) {
  const body = guide[lang];
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: body.title,
    description: body.description,
    inLanguage: lang,
    datePublished: guide.published,
    dateModified: guide.updated,
    mainEntityOfPage: `${SITE}${guidePath(guide.slug, lang)}`,
    author: { '@type': 'Organization', name: 'WakeelCheck', url: SITE },
    publisher: { '@type': 'Organization', name: 'WakeelCheck', logo: { '@type': 'ImageObject', url: `${SITE}/brand/mark.svg` } },
    citation: guide.sources.map((s) => s.url),
  };
}

export default function GuidePage({ guide, lang }: { guide: Guide; lang: Lang }) {
  const body = guide[lang];
  const t = T[lang];
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(guide, lang)).replace(/</g, '\\u003c') }}
      />
      <SiteHeader lang={lang} other={guidePath(guide.slug, lang === 'ar' ? 'en' : 'ar')} />
      <main id="main" className="container legal-page guide-page">
        <a className="eyebrow" href={lang === 'ar' ? '/guides' : '/en/guides'}>
          {t.guides}
        </a>
        <h1>{body.title}</h1>
        <p className="micro">
          {t.updated}: <time dateTime={guide.updated}>{guide.updated}</time>
        </p>
        <section className="guide-answer" aria-label={t.short}>
          <h2>{t.short}</h2>
          <p>{body.answer}</p>
        </section>
        {body.blocks.map((b, i) =>
          b.kind === 'h2' ? (
            <h2 key={i}>{b.text}</h2>
          ) : b.kind === 'p' ? (
            <p key={i}>{b.text}</p>
          ) : b.kind === 'code' ? (
            <pre key={i}>
              <code>{b.text}</code>
            </pre>
          ) : b.kind === 'note' ? (
            <p key={i} className="guide-note">
              {b.text}
            </p>
          ) : b.kind === 'ol' ? (
            <ol key={i}>{b.items.map((x) => <li key={x}>{x}</li>)}</ol>
          ) : (
            <ul key={i}>{b.items.map((x) => <li key={x}>{x}</li>)}</ul>
          )
        )}
        <a className="button primary guide-cta" href={homeOf(lang)}>
          {t.cta}
        </a>
        <section className="guide-sources">
          <h2>{t.sources}</h2>
          <ol>
            {guide.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="noopener" target="_blank" dir="ltr">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </>
  );
}

export function GuidesIndex({ lang, guides }: { lang: Lang; guides: readonly Guide[] }) {
  const title = lang === 'ar' ? 'أدلة الظهور في إجابات الذكاء الاصطناعي' : 'Guides to appearing in AI answers';
  const sub =
    lang === 'ar'
      ? 'كيف يقرأ ChatGPT وGoogle وClaude متجرك، وكيف يذكرونه — بخطوات ومصادر رسمية.'
      : 'How ChatGPT, Google and Claude read your store, and how they come to name it — with steps and official sources.';
  return (
    <>
      <SiteHeader lang={lang} other={lang === 'ar' ? '/en/guides' : '/guides'} />
      <main id="main" className="container legal-page guide-page">
        <span className="eyebrow">AITCHEK</span>
        <h1>{title}</h1>
        <p>{sub}</p>
        <div className="guide-list">
          {guides.map((g) => (
            <a key={g.slug} className="guide-card" href={guidePath(g.slug, lang)}>
              <h2>{g[lang].title}</h2>
              <p>{g[lang].description}</p>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter lang={lang} />
    </>
  );
}
