/**
 * صفحةٌ قانونية بهوية الحزمة — بلا JavaScript: نصٌّ يُقرأ ويُراجَع.
 */

import { SUPPORT_EMAIL, legal, legalNav, type LegalKind } from '@/lib/legal-copy';

export function legalHref(locale: 'ar' | 'en', kind: LegalKind): string {
  return locale === 'ar' ? `/${kind}` : `/en/${kind}`;
}

export default function Legal({ locale, kind }: { locale: 'ar' | 'en'; kind: LegalKind }) {
  const doc = legal[locale][kind];
  const nav = legalNav[locale];
  const home = locale === 'ar' ? '/' : '/en';
  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" href={home} aria-label={nav.back}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.svg" width={40} height={40} alt="" />
            <span>
              {locale === 'ar' ? (
                <>
                  <span className="brand-ar">وكيل تشيك</span>
                  <span className="brand-small">AITCHEK</span>
                </>
              ) : (
                <span className="brand-name">AITCHEK</span>
              )}
            </span>
          </a>
          <nav className="nav" aria-label={nav.terms}>
            {(['terms', 'privacy', 'refund'] as const).map((k) => (
              <a key={k} href={legalHref(locale, k)} aria-current={k === kind ? 'page' : undefined}>
                {nav[k]}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="container legal-page">
        <span className="eyebrow">AITCHEK</span>
        <h1>{doc.title}</h1>
        <p className="micro">{doc.updated}</p>
        {doc.sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.p.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
        <p className="legal-contact">
          {nav.contact}: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <a className="text-button" href={home}>
          {nav.back}
        </a>
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <span className="eyebrow">AITCHEK</span>
            <nav className="footer-links" aria-label={nav.terms}>
              {(['terms', 'privacy', 'refund'] as const).map((k) => (
                <a key={k} href={legalHref(locale, k)}>
                  {nav[k]}
                </a>
              ))}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </nav>
          </div>
        </div>
      </footer>
    </>
  );
}
