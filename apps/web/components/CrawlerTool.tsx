'use client';

/**
 * فاحص زواحف الذكاء الاصطناعي — الواجهة. بأصناف الحزمة (input-shell،
 * table-wrap، presence)، والمنطق في `lib/crawler-check.ts`.
 */

import { useState } from 'react';
import type { CrawlerReport } from '@/lib/crawler-check';

const T = {
  ar: {
    label: 'نطاق المتجر',
    cta: 'افحص الزواحف',
    busy: 'نقرأ robots.txt…',
    bad: 'أدخل نطاقاً صحيحاً، مثل yourstore.com',
    limit: 'تجاوزت عدد الفحوص في الساعة. حاول بعد قليل.',
    fail: 'تعذّر قراءة robots.txt لهذا النطاق. تأكّد من العنوان وأعد المحاولة.',
    bot: 'الزاحف',
    role: 'الدور',
    state: 'الحالة',
    search: 'بحث مباشر',
    training: 'تدريب',
    allowed: 'مسموح',
    blocked: 'محظور',
    absent: 'لا يوجد ملف robots.txt — لا قيد على أيّ زاحف.',
    good: 'زواحف البحث المباشر كلّها مسموحة: محرّكات الذكاء الاصطناعي تستطيع قراءة متجرك.',
    bad2: 'زواحف بحث محظورة — هذه تُخفي متجرك من إجابات محرّكها:',
    note: 'نقرأ الملف المنشور فقط. حظر Cloudflare أو جدار الحماية لا يظهر فيه — راجع إعداداتهما.',
    next: 'السماح بالقراءة شرطٌ لا ضمان. لترى ما يقوله ChatGPT وGoogle عن متجرك فعلاً:',
    scan: 'افحص ظهور متجرك مجاناً',
  },
  en: {
    label: 'Store domain',
    cta: 'Check crawlers',
    busy: 'Reading robots.txt…',
    bad: 'Enter a valid domain, such as yourstore.com',
    limit: 'Too many checks this hour. Try again shortly.',
    fail: 'Could not read robots.txt for this domain. Check the address and try again.',
    bot: 'Crawler',
    role: 'Role',
    state: 'Status',
    search: 'Live search',
    training: 'Training',
    allowed: 'Allowed',
    blocked: 'Blocked',
    absent: 'No robots.txt — no crawler is restricted.',
    good: 'All live-search crawlers are allowed: AI engines can read your store.',
    bad2: 'Search crawlers blocked — these hide your store from their engine’s answers:',
    note: 'We read the published file only. Cloudflare or firewall blocks do not show in it — check those settings.',
    next: 'Being readable is a condition, not a guarantee. To see what ChatGPT and Google actually say about your store:',
    scan: 'Scan your store’s visibility for free',
  },
} as const;

export default function CrawlerTool({ lang }: { lang: 'ar' | 'en' }) {
  const t = T[lang];
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<CrawlerReport | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim() === '') return setError(t.bad);
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const res = await fetch(`/api/tools/crawlers?domain=${encodeURIComponent(input.trim())}`);
      if (res.status === 400) setError(t.bad);
      else if (res.status === 429) setError(t.limit);
      else if (!res.ok) setError(t.fail);
      else setReport((await res.json()) as CrawlerReport);
    } catch {
      setError(t.fail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool">
      <form className="scan-form" onSubmit={run} noValidate>
        <label htmlFor="tool-domain" className="sr-only">
          {t.label}
        </label>
        <div className="input-shell">
          <input
            id="tool-domain"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourstore.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? t.busy : t.cta}
          </button>
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
      </form>

      {report !== null && (
        <section className="tool-result" aria-live="polite">
          <p className={`status-bar ${report.blockedSearch.length === 0 ? 'positive' : ''}`}>
            {report.robots === 'absent' ? t.absent : report.blockedSearch.length === 0 ? t.good : `${t.bad2} ${report.blockedSearch.join(' · ')}`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.bot}</th>
                  <th scope="col">{t.role}</th>
                  <th scope="col">{t.state}</th>
                </tr>
              </thead>
              <tbody>
                {report.verdicts.map((v) => (
                  <tr key={v.agent}>
                    <td>
                      <bdi>{v.agent}</bdi>
                      <br />
                      <span className="micro">{v.engine[lang]}</span>
                    </td>
                    <td>{v.purpose === 'search' ? t.search : t.training}</td>
                    <td>
                      <span className={`presence ${v.allowed ? 'yes' : 'no'}`}>{v.allowed ? t.allowed : t.blocked}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="technical-note">{t.note}</p>
          <p className="tool-next">
            {t.next}{' '}
            <a className="button primary" href={lang === 'ar' ? '/' : '/en'}>
              {t.scan}
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
