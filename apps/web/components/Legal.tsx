/**
 * صفحةٌ قانونية بهوية الحزمة — بلا JavaScript: نصٌّ يُقرأ ويُراجَع.
 */

import { SUPPORT_EMAIL, legal, legalNav, type LegalKind } from '@/lib/legal-copy';
import { SiteFooter, SiteHeader } from '@/components/Chrome';

export function legalHref(locale: 'ar' | 'en', kind: LegalKind): string {
  return locale === 'ar' ? `/${kind}` : `/en/${kind}`;
}

export default function Legal({ locale, kind }: { locale: 'ar' | 'en'; kind: LegalKind }) {
  const doc = legal[locale][kind];
  const nav = legalNav[locale];
  const home = locale === 'ar' ? '/' : '/en';
  return (
    <>
      <SiteHeader lang={locale} other={legalHref(locale === 'ar' ? 'en' : 'ar', kind)} />
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
      <SiteFooter lang={locale} />
    </>
  );
}
