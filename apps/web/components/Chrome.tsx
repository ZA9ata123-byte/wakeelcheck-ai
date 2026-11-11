/**
 * الشريط والتذييل للصفحات الثابتة (الأدلة والصفحات القانونية) — بأصناف
 * الحزمة نفسها، وبلا JavaScript.
 */

import { SUPPORT_EMAIL, legalNav } from '@/lib/legal-copy';

type Lang = 'ar' | 'en';

const NAV = {
  ar: { guides: 'الأدلة', home: 'افحص متجرك', tool: 'فاحص الزواحف' },
  en: { guides: 'Guides', home: 'Scan my store', tool: 'Crawler checker' },
} as const;

export const homeOf = (lang: Lang): string => (lang === 'ar' ? '/' : '/en');
export const guidesOf = (lang: Lang): string => (lang === 'ar' ? '/guides' : '/en/guides');
const legalOf = (lang: Lang, k: string): string => (lang === 'ar' ? `/${k}` : `/en/${k}`);

export function SiteHeader({ lang, other }: { lang: Lang; other: string }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <a className="brand" href={homeOf(lang)} aria-label={NAV[lang].home}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.svg" width={40} height={40} alt="" />
          <span>
            {lang === 'ar' ? (
              <>
                <span className="brand-ar">وكيل تشيك</span>
                <span className="brand-small">AITCHEK</span>
              </>
            ) : (
              <span className="brand-name">AITCHEK</span>
            )}
          </span>
        </a>
        <nav className="nav" aria-label={NAV[lang].guides}>
          <a href={guidesOf(lang)}>{NAV[lang].guides}</a>
          <a href={lang === 'ar' ? '/tools/ai-crawlers' : '/en/tools/ai-crawlers'}>{NAV[lang].tool}</a>
          <a href={homeOf(lang)}>{NAV[lang].home}</a>
        </nav>
        <div className="header-tools">
          <a className="lang-switch" href={other} hrefLang={lang === 'ar' ? 'en' : 'ar'}>
            {lang === 'ar' ? 'EN' : 'AR'}
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ lang }: { lang: Lang }) {
  const nav = legalNav[lang];
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <span className="eyebrow">AITCHEK</span>
          <nav className="footer-links" aria-label={nav.terms}>
            <a href={guidesOf(lang)}>{NAV[lang].guides}</a>
            <a href={lang === 'ar' ? '/tools/ai-crawlers' : '/en/tools/ai-crawlers'}>{NAV[lang].tool}</a>
            {(['terms', 'privacy', 'refund'] as const).map((k) => (
              <a key={k} href={legalOf(lang, k)}>
                {nav[k]}
              </a>
            ))}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
