import Scanner from '@/components/Scanner';
import { copy, type Locale } from '@/lib/i18n';

/** الصفحة نفسها للّغتين — يتغيّر النص والاتجاه فقط، لا التخطيط. */
export default function Landing({ locale }: { locale: Locale }) {
  const t = copy[locale];

  return (
    <>
      <div className="shell">
        <nav className="bar">
          <div className="logo">
            <span className="dot" /> {locale === 'ar' ? 'وكيل تشيك' : 'WakeelCheck'}
          </div>
          <div style={{ display: 'flex', gap: '1.1rem' }}>
            <a href={t.otherHref}>{t.other}</a>
            <a href="#price">{t.nav}</a>
          </div>
        </nav>

        <header className="hero">
          <h1>
            {t.headA}
            <span className="hit">{t.headB}</span>.
          </h1>
          <p className="sub">{t.sub}</p>
          <Scanner t={t} locale={locale} />
        </header>
      </div>

      <div className="shell">
        <section className="blk">
          <div className="kicker">what we can and cannot see</div>
          <h2>{t.measureTitle}</h2>
          <p className="lede">{t.measureLede}</p>

          <div className="split">
            <div className="hcol" data-tone="yes">
              <h3>{t.yesTitle}</h3>
              <ul>
                {t.yes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="why">{t.yesWhy}</p>
            </div>

            <div className="hcol" data-tone="no">
              <h3>{t.noTitle}</h3>
              <ul>
                {t.no.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="why">{t.noWhy}</p>
            </div>
          </div>
        </section>

        <section className="blk" id="price">
          <div className="kicker">pricing</div>
          <h2>{t.priceTitle}</h2>

          <div className="pricebox">
            <div className="tier">
              <span className="t-name">{t.freeName}</span>
              <span className="t-price">{t.freePrice}</span>
              <ul>
                {t.freeItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="tier" data-main="true">
              <span className="t-name">{t.paidName}</span>
              <span className="t-price">
                {t.paidPrice}
                <small>{t.paidUnit}</small>
              </span>
              <ul>
                {t.paidItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="foot">
          <span>{locale === 'ar' ? 'وكيل تشيك' : 'WakeelCheck'} — aitchek.online</span>
          <span className="mono">v0.1</span>
        </div>
      </div>
    </>
  );
}
