'use client';

/**
 * الواجهة — حزمة المصمم (aitchek-frontend) منقولةً إلى React، ببياناتٍ حقيقية.
 *
 * البنية وأسماء الأصناف كما في app.js حرفاً، فيعمل styles.css كما رسمه:
 * الرئيسية، ثم صفحة الفحص بمراحلها الأربع، ثم التقرير بتبويباته الأربعة.
 *
 * ما تغيّر عن الحزمة هو المحتوى وحده: الفحص يجري فعلاً (POST ثم سؤالٌ حتى
 * يكتمل)، والتقرير يُبنى من النتيجة، ورابطه `?r=` يفتحه بلا فحصٍ جديد.
 * وأُزيل من الحزمة ما كان أداة مراجعةٍ للتصميم: مُبدّل «حالة المعاينة».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineAnswer, MatrixRow, ScanResult } from '@wakeelcheck/core';
import { buildMatrix, countryCode } from '@wakeelcheck/visibility';
import { studioCopy, type StudioCopy, type StudioLocale } from '@/lib/studio-copy';
import { answerSources } from '@/lib/sources';
import { citeHost, parseAnswer, type Inline } from '@/lib/answer-format';
import { pickCause } from '@/lib/cause';
import { useTurnstile } from '@/components/turnstile';
import { SUPPORT_EMAIL, legalNav } from '@/lib/legal-copy';

// ── الأيقونات: مسارات الحزمة نفسها ─────────────────────────────

const ICONS = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20 15.1A8.5 8.5 0 0 1 8.9 4 8.5 8.5 0 1 0 20 15.1Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  copy: 'M9 9h11v12H9ZM15 9V3H3v12h6',
  check: 'm5 12 4 4L19 6',
  info: 'M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  chevron: 'm6 9 6 6 6-6',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  shield: 'm12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
  search: 'M16 16 21 21M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  pause: 'M8 5v14M16 5v14',
  minus: 'M5 12h14',
  lock: 'M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0v3',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
} as const;

function Icon({ name, className = '' }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const Mark = ({ size = 40, className }: { size?: number; className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/brand/mark.svg" width={size} height={size} alt="" className={className} />
);

// ── الإجابة: الأسماء معلَّمة، واللاتيني معزول ──────────────────

function markRivals(text: string, names: readonly string[]): React.ReactNode[] {
  const usable = [...new Set(names)].filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
  if (usable.length === 0) return [text];
  const escaped = usable.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text
    .split(new RegExp(`(${escaped.join('|')})`, 'g'))
    .map((part, i) => (usable.includes(part) ? <mark key={i}>{part}</mark> : part));
}

function isolateLatin(nodes: React.ReactNode[]): React.ReactNode[] {
  return nodes.flatMap((node, i): React.ReactNode[] =>
    typeof node !== 'string'
      ? [node]
      : node
          .split(/([A-Za-z][A-Za-z0-9&'’.\- ]*[A-Za-z0-9])/)
          .map((part, j) => (/^[A-Za-z]/.test(part) ? <bdi key={`${i}-${j}`}>{part}</bdi> : part))
  );
}

function renderAnswer(text: string, rivals: readonly string[]): React.ReactNode {
  const inline = (parts: Inline[]): React.ReactNode[] =>
    parts.map((part, i) =>
      part.kind === 'cite' ? (
        <a key={i} className="cite" href={part.href} target="_blank" rel="noopener noreferrer nofollow" dir="ltr">
          {citeHost(part.href, part.label)}
        </a>
      ) : part.kind === 'strong' ? (
        <strong key={i}>{isolateLatin(markRivals(part.text, rivals))}</strong>
      ) : (
        <span key={i}>{isolateLatin(markRivals(part.text, rivals))}</span>
      )
    );
  return parseAnswer(text).map((block, i) =>
    block.kind === 'p' ? (
      <p key={i}>{inline(block.inline)}</p>
    ) : block.kind === 'heading' ? (
      <p key={i} className="answer-heading">
        {inline(block.inline)}
      </p>
    ) : block.ordered ? (
      <ol key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ol>
    ) : (
      <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
    )
  );
}

const ENGINE_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  ai_mode: 'Google AI Mode',
  ai_overviews: 'Google AI Overviews',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
};
const engineName = (e: string): string => ENGINE_NAMES[e] ?? e;
const engineGlyph = (e: string): string => (e === 'chatgpt' ? '✳' : e.startsWith('ai_') ? 'G' : '•');

// ── الرابط ───────────────────────────────────────────────────

function reportIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('r');
  return id !== null && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

function cleanDomain(input: string): string | null {
  const raw = input.trim();
  if (raw === '' || /\s/.test(raw)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Page = 'home' | 'scan' | 'report';
type Tab = 'evidence' | 'matrix' | 'readiness' | 'security';
type Failure = 'error' | 'quota' | 'human' | 'gone';

// ─────────────────────────────────────────────────────────────

export default function Studio({ locale }: { locale: StudioLocale }) {
  const t: StudioCopy = studioCopy[locale];
  const ar = locale === 'ar';
  const { box: humanBox, take: takeHumanToken } = useTurnstile(TURNSTILE_SITE_KEY, locale);

  const [page, setPage] = useState<Page>('home');
  const [input, setInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [domain, setDomain] = useState('');
  const [step, setStep] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>('evidence');
  const [engine, setEngine] = useState<string>('');
  const [qIdx, setQIdx] = useState(0);
  const [filter, setFilter] = useState<'all' | 'needs' | 'passed'>('all');
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [reduced, setReduced] = useState(false);
  const [toastText, setToastText] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const timers = useRef<number[]>([]);
  const cancelled = useRef(false);
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearInterval(id));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // الوضع والحركة: يضعهما سكربت التخطيط قبل الرسم، وهنا تُقرأ القيمة فقط.
  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
    setReduced(root.classList.contains('reduce-motion'));
  }, []);

  const toast = useCallback((message: string) => {
    setToastText(message);
    setToastOn(true);
    const id = window.setTimeout(() => setToastOn(false), 3200);
    timers.current.push(id);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('aitchek-theme', next);
    } catch {
      // تخزينٌ محجوب: الاختيار لهذه الصفحة وحدها.
    }
    setTheme(next);
  }, [theme]);

  const toggleMotion = useCallback(() => {
    const next = !reduced;
    document.documentElement.classList.toggle('reduce-motion', next);
    try {
      localStorage.setItem('aitchek-motion', next ? 'reduce' : 'full');
    } catch {
      // كما فوق.
    }
    setReduced(next);
  }, [reduced]);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(t.copied);
      } catch {
        toast(t.copyFailed);
      }
    },
    [t, toast]
  );

  const go = useCallback((next: Page) => {
    setPage(next);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const goSection = useCallback(
    (id: string) => {
      setMenu(false);
      const scroll = () => document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'instant' as ScrollBehavior : 'smooth', block: 'start' });
      if (page !== 'home') {
        setPage('home');
        window.setTimeout(scroll, 60);
      } else scroll();
    },
    [page, reduced]
  );

  const showResult = useCallback((result: ScanResult) => {
    setScan(result);
    setFailure(null);
    setDomain(result.profile?.domain ?? '');
    setTab('evidence');
    setQIdx(0);
    setFilter('all');
    const first = result.answers[0]?.engine ?? '';
    setEngine(first);
  }, []);

  // ── السؤال حتى يكتمل الفحص ──────────────────────────────────
  const poll = useCallback(async (scanId: string): Promise<ScanResult> => {
    // 120 × 1.2 ث ≈ 144 ث: أطول من سقف الدالة (120)، فلا يستسلم المتصفّح قبل الخادم.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      if (cancelled.current) throw new Error('cancelled');
      const res = await fetch(`/api/scan/${scanId}`);
      if (!res.ok) continue;
      const result = (await res.json()) as ScanResult;
      if (result.status === 'done') return result;
      if (result.status === 'failed') throw new Error(result.error ?? 'failed');
    }
    throw new Error('timeout');
  }, []);

  // رابط تقرير `?r=`: يُفتح بلا فحصٍ جديد ولا كلفة.
  useEffect(() => {
    const id = reportIdFrom(window.location.search);
    if (id === null) return;
    setDomain('…');
    setStep(3);
    setPage('scan');
    const open = async (): Promise<ScanResult> => {
      const res = await fetch(`/api/scan/${encodeURIComponent(id)}`);
      if (res.status === 404) throw new Error('gone');
      if (res.ok) {
        const first = (await res.json()) as ScanResult;
        if (first.status === 'done') return first;
        if (first.status === 'failed') throw new Error('failed');
      }
      return poll(id);
    };
    open()
      .then((result) => {
        showResult(result);
        setPage('report');
      })
      .catch((err: unknown) => {
        setFailure(err instanceof Error && err.message === 'gone' ? 'gone' : 'error');
        setPage('report');
      });
    // مرّةً عند التحميل.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runScan = useCallback(
    async (target: string) => {
      clearTimers();
      cancelled.current = false;
      setScan(null);
      setFailure(null);
      setDomain(target);
      setStep(0);
      go('scan');

      // المراحل تتقدّم بصرياً بينما يعمل الفحص فعلاً، وتقف عند الأخيرة حتى يكتمل.
      const tick = window.setInterval(() => setStep((s) => Math.min(s + 1, 3)), 6000);
      timers.current.push(tick);

      const fail = (kind: Failure) => {
        clearTimers();
        if (cancelled.current) return;
        setFailure(kind);
        setPage('report');
      };

      try {
        const token = await takeHumanToken();
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(token === null ? { url: target } : { url: target, turnstileToken: token }),
        });
        if (res.status === 429) return fail('quota');
        if (res.status === 403) return fail('human');
        if (!res.ok) return fail('error');

        const { scanId, demo: isDemo } = (await res.json()) as { scanId: string; demo?: boolean };
        setDemo(isDemo === true);
        const result = await poll(scanId);
        clearTimers();
        if (cancelled.current) return;
        showResult(result);
        setPage('report');
        window.history.replaceState(null, '', `${window.location.pathname}?r=${encodeURIComponent(scanId)}`);
      } catch {
        fail('error');
      }
    },
    [clearTimers, go, poll, showResult, takeHumanToken]
  );

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const target = cleanDomain(input);
      if (target === null) {
        setDomainError(t.domainError);
        return;
      }
      setDomainError('');
      void runScan(target);
    },
    [input, runScan, t]
  );

  const cancelScan = useCallback(() => {
    cancelled.current = true;
    clearTimers();
    go('home');
  }, [clearTimers, go]);

  const subscribe = useCallback(() => {
    const target = scan?.profile?.domain ?? (domain !== '' && domain !== '…' ? domain : null);
    if (target === null) {
      toast(t.scanFirst);
      goSection('top');
      return;
    }
    window.location.href = `/api/billing/checkout?domain=${encodeURIComponent(target)}&locale=${locale}`;
  }, [domain, goSection, locale, scan, t, toast]);

  // ── مشتقّات التقرير ──────────────────────────────────────────
  const answers: EngineAnswer[] = scan?.answers ?? [];
  const engines = useMemo(() => [...new Set(answers.map((a) => a.engine))], [answers]);
  const questions = scan?.questions ?? [];
  const question = questions[qIdx] ?? questions[0] ?? null;
  const answer =
    answers.find((a) => a.engine === engine && a.questionId === question?.id) ??
    (question === null ? answers.find((a) => a.engine === engine) : undefined) ??
    null;
  const rivals = answer?.competitors.map((c) => c.name) ?? [];
  const sources = answerSources(answer?.citedUrls ?? []);
  const cause = scan === null ? null : pickCause(scan.rules);
  const sov = scan?.shareOfVoice ?? null;
  const matrix: MatrixRow[] = sov === null || sov.byEngine.length === 0 ? [] : buildMatrix(sov.byEngine, t.you);
  const matrixEngines = sov?.byEngine.map((r) => r.engine) ?? [];
  const rules = scan?.rules ?? [];
  const passedCount = rules.filter((r) => r.passed).length;
  const needsCount = rules.length - passedCount;
  const country = scan?.profile?.country ?? null;
  const localeLine = [
    country === null ? null : ar ? country : t.countries[countryCode(country) ?? ''] ?? country,
    // لغة المتجر بلغة الواجهة: «العربية» في الصفحة العربية، «Arabic» في الإنجليزية.
    scan?.profile?.locale?.startsWith('en') ? (ar ? 'الإنجليزية' : 'English') : ar ? 'العربية' : 'Arabic',
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  const arrow = <Icon name={ar ? 'back' : 'arrow'} />;
  const otherHref = `${t.otherHref}${scan === null ? '' : `?r=${encodeURIComponent(scan.id)}`}`;

  // ── الأجزاء ──────────────────────────────────────────────────

  const header = (
    <header className="header">
      <div className="container header-inner">
        <button className="brand" onClick={() => go('home')} aria-label={t.home}>
          <Mark />
          <span>
            {ar ? (
              <>
                <span className="brand-ar">وكيل تشيك</span>
                <span className="brand-small">AITCHEK</span>
              </>
            ) : (
              <span className="brand-name">AITCHEK</span>
            )}
          </span>
        </button>
        <nav className="nav" aria-label={t.menu}>
          <button onClick={() => goSection('how')}>{t.how}</button>
          <button onClick={() => (scan !== null ? go('report') : goSection('evidence'))}>{t.report}</button>
          <button onClick={() => goSection('pricing')}>{t.pricing}</button>
        </nav>
        <div className="header-tools">
          <label className="lang-wrap">
            <span className="sr-only">{t.language}</span>
            <select
              id="language"
              aria-label={t.language}
              value={locale}
              onChange={(e) => {
                if (e.target.value !== locale) window.location.href = otherHref;
              }}
            >
              <option value="ar">AR</option>
              <option value="en">EN</option>
            </select>
          </label>
          <button className="icon-btn" onClick={toggleTheme} aria-label={t.theme} title={t.theme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            className="icon-btn mobile-menu-button"
            onClick={() => setMenu(!menu)}
            aria-label={t.openMenu}
            aria-expanded={menu}
            aria-controls="mobile-menu"
          >
            <Icon name={menu ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
      {menu && (
        <nav className="mobile-menu" id="mobile-menu" aria-label={t.menu}>
          <button onClick={() => go('home')}>{t.home}</button>
          <button onClick={() => goSection('how')}>{t.how}</button>
          <button onClick={() => (scan !== null ? go('report') : goSection('evidence'))}>{t.report}</button>
          <button onClick={() => goSection('pricing')}>{t.pricing}</button>
        </nav>
      )}
    </header>
  );

  const footer = (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <span className="eyebrow">AITCHEK</span>
          <p>{t.footerNote}</p>
          <nav className="footer-links" aria-label={legalNav[locale].terms}>
            {(['terms', 'privacy', 'refund'] as const).map((k) => (
              <a key={k} href={ar ? `/${k}` : `/en/${k}`}>
                {legalNav[locale][k]}
              </a>
            ))}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </nav>
        </div>
        <div className="footer-controls">
          <span className="micro">{t.footer}</span>
          <button className="text-button" onClick={toggleMotion} aria-pressed={reduced}>
            <Icon name="pause" />
            {t.motion}
          </button>
        </div>
      </div>
    </footer>
  );

  const home = (
    <main id="main" tabIndex={-1} className="page-enter">
      <section className="hero" id="top">
        <div className="hero-halo" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="halo-motion" src="/brand/halo.svg" width={1000} height={600} fetchPriority="high" alt="" />
        </div>
        <div className="container">
          <div className="badge hero-badge">
            <span className="dot" />
            {t.badge}
          </div>
          <div className="hero-content">
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>
              {t.heroA}
              <span>{t.heroB}</span>
            </h1>
            <p className="hero-sub">{t.sub}</p>
            <form className="scan-form" id="scan-form" noValidate onSubmit={submit}>
              <label htmlFor="domain" className="sr-only">
                {t.domain}
              </label>
              <div className="input-shell">
                <Icon name="link" />
                <input
                  id="domain"
                  name="domain"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={253}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="yourstore.com"
                  aria-describedby="domain-error"
                />
                <button className="button primary" type="submit">
                  {t.scan}
                  {arrow}
                </button>
              </div>
              <p className="form-error" id="domain-error" role="alert">
                {domainError}
              </p>
              <div ref={humanBox} className="human-check" />
            </form>
            <p className="micro">{t.freeNote}</p>
            <div className="engines-label">
              <span className="engine-name">
                <span className="engine-glyph">✳</span> ChatGPT
              </span>
              <span className="engine-name">
                <span className="engine-glyph">G</span> Google AI Mode
              </span>
            </div>
            <div className="hero-tail">
              <span />
              <button className="text-button demo-link" onClick={() => goSection('evidence')}>
                {t.viewDemo}
                {arrow}
              </button>
              <span />
            </div>
          </div>
        </div>
      </section>

      <section className="container section preview-section" id="evidence">
        <div className="section-heading reveal">
          <div>
            <span className="section-kicker">01 / {t.evidence}</span>
            <h2>{t.previewTitle}</h2>
          </div>
          <p>{t.previewSub}</p>
        </div>
        <div className="preview-grid">
          <div className="panel evidence-preview reveal">
            <div className="engine-tabs" role="tablist" aria-label="Engine">
              <button role="tab" aria-selected="true" tabIndex={0}>
                <span className="engine-glyph" aria-hidden="true">
                  G
                </span>
                <bdi>Google AI Mode</bdi>
              </button>
            </div>
            <p className="question-mini">{t.previewQ}</p>
            <blockquote className="preview-quote">
              {t.previewIntro}{' '}
              <mark>
                <bdi>The Perfume Smell</bdi>
              </mark>{' '}
              ·{' '}
              <mark>
                <bdi>Perfumes Kuwait</bdi>
              </mark>{' '}
              · <mark>{t.previewThird}</mark>…
            </blockquote>
            <div className="preview-bottom">
              <span className="source-count">{t.previewMeta}</span>
              <button className="text-button" onClick={() => goSection('top')}>
                {t.scan}
                {arrow}
              </button>
            </div>
          </div>
          <div className="panel next-preview reveal">
            <div>
              <span className="small-title">{t.next}</span>
              <h3>{t.heroNote}</h3>
              <p>{t.nextDesc}</p>
            </div>
            <div className="mini-priorities">
              {t.insights.map((x, i) => (
                <div className="mini-priority" key={x}>
                  <span className="step-n">0{i + 1}</span>
                  <span>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section how-section" id="how">
        <div className="container">
          <div className="section-heading reveal">
            <div>
              <span className="section-kicker">02 / {t.how}</span>
              <h2>{t.howTitle}</h2>
            </div>
            <p>{t.howSub}</p>
          </div>
          <div className="steps-grid">
            {t.steps.map((x, i) => (
              <article className="how-step reveal" key={x}>
                <span className="step-n">0{i + 1}</span>
                <h3>{x}</h3>
                <p>{t.stepDesc[i]}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="container agent-band reveal">
        <Mark />
        <div>
          <h2>{t.agentTitle}</h2>
          <p>{t.agentDesc}</p>
        </div>
        <span className="badge">{t.coming}</span>
      </section>

      <section className="container section" id="pricing">
        <div className="section-heading reveal">
          <div>
            <span className="section-kicker">03 / {t.pricing}</span>
            <h2>{t.pricingTitle}</h2>
          </div>
          <p>{t.pricingSub}</p>
        </div>
        <div className="prices-grid two">
          <article className="price-card reveal">
            <h3>{t.free}</h3>
            <div className="price-number">{t.freePrice}</div>
            <span className="micro">{t.badge}</span>
            <p>{t.freeDesc}</p>
            <button className="button secondary" onClick={() => goSection('top')}>
              {t.scan}
            </button>
          </article>
          <article className="price-card featured reveal">
            <h3>{t.paid}</h3>
            <div className="price-number">$39</div>
            <span className="micro">{t.paidUnit}</span>
            <p>{t.paidDesc}</p>
            <button className="button primary" onClick={subscribe}>
              {t.subscribe}
              {arrow}
            </button>
          </article>
        </div>
      </section>
    </main>
  );

  const scanPage = (
    <main id="main" tabIndex={-1} className="page-enter">
      <section className="scan-page">
        <span className="domain-pill">
          <Icon name="link" />
          <bdi>{domain}</bdi>
        </span>
        <h1>{t.scanTitle}</h1>
        <p>{t.scanSub}</p>
        <div className="scan-orbit" aria-hidden="true">
          <Mark />
          <div className="scan-number">
            <span>0{step + 1}</span> / 04
          </div>
        </div>
        <div className="scan-steps" role="status" aria-live="polite">
          {t.scanSteps.map((x, i) => (
            <div
              key={x}
              className={`scan-step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}
              aria-current={step === i ? 'step' : undefined}
            >
              <span className="step-circle">
                {step > i ? <Icon name="check" className="small" /> : String(i + 1).padStart(2, '0')}
              </span>
              <span>{x}</span>
            </div>
          ))}
        </div>
        <p className="micro">{t.scanReal}</p>
        <div className="scan-actions">
          <button className="text-button" onClick={cancelScan}>
            {t.cancel}
          </button>
        </div>
      </section>
    </main>
  );

  const stateScreen = (kind: Failure) => {
    const map = {
      error: { icon: 'refresh', title: t.errorTitle, desc: t.errorDesc, label: t.retry },
      quota: { icon: 'lock', title: t.quotaTitle, desc: t.quotaDesc, label: t.viewPlans },
      human: { icon: 'shield', title: t.humanTitle, desc: t.humanDesc, label: t.retry },
      gone: { icon: 'clock', title: t.goneTitle, desc: t.goneDesc, label: t.scan },
    } as const;
    const s = map[kind];
    return (
      <section className="state-screen tab-content">
        <div className="state-symbol">
          <Icon name={s.icon} />
        </div>
        <h2>{s.title}</h2>
        <p>{s.desc}</p>
        <button
          className="button primary"
          onClick={() => {
            if (kind === 'quota') goSection('pricing');
            else if (kind === 'gone' || domain === '' || domain === '…') goSection('top');
            else void runScan(domain);
          }}
        >
          {s.label}
        </button>
      </section>
    );
  };

  const evidence = (
    <div className="report-layout">
      <div className="report-main">
        <div className="engine-tabs" role="tablist" aria-label="Engine">
          {engines.map((e) => (
            <button
              key={e}
              role="tab"
              aria-selected={engine === e}
              tabIndex={engine === e ? 0 : -1}
              onClick={() => setEngine(e)}
            >
              <span className="engine-glyph" aria-hidden="true">
                {engineGlyph(e)}
              </span>
              <bdi>{engineName(e)}</bdi>
            </button>
          ))}
        </div>
        {question !== null && (
          <section className="question-box">
            <span className="label">
              {t.question}
              <span className="micro">
                {String(qIdx + 1).padStart(2, '0')} / {String(questions.length).padStart(2, '0')}
                {questions.length > 1 && (
                  <>
                    {' · '}
                    <button className="text-button question-next" onClick={() => setQIdx((qIdx + 1) % questions.length)}>
                      {t.nextQuestion}
                    </button>
                  </>
                )}
              </span>
            </span>
            <p>{question.text}</p>
          </section>
        )}
        {answer === null || answer.answerText.trim() === '' ? (
          <section className="state-screen tab-content">
            <div className="state-symbol">
              <Icon name="clock" />
            </div>
            <h2>{t.missingTitle}</h2>
            <p>{t.missingDesc}</p>
          </section>
        ) : (
          <>
            <article className="answer-card">
              <div className="label">
                <span>{t.answer}</span>
                <button className="icon-btn" onClick={() => void copyText(answer.answerText)} aria-label={t.copy}>
                  <Icon name="copy" />
                </button>
              </div>
              <div className="answer-copy">{renderAnswer(answer.answerText, rivals)}</div>
              <p className="answer-foot">{t.verbatim}</p>
            </article>
            <div className={`status-bar ${answer.storeMentioned ? 'positive' : ''}`}>
              <Icon name="info" />
              <span>{answer.storeMentioned ? t.mentioned : t.notMentioned}</span>
            </div>
          </>
        )}
      </div>
      <aside className="report-sidebar">
        <section className="aside-section competitors-panel">
          <h2>{t.competitors}</h2>
          {rivals.length === 0 ? (
            <p className="micro">{t.noCompetitors}</p>
          ) : (
            <div className="competitor-list">
              {[...new Set(rivals)].map((name) => (
                <span className="competitor-chip" key={name}>
                  <bdi>{name}</bdi>
                </span>
              ))}
            </div>
          )}
        </section>
        <section className="aside-section sources-panel">
          <h2>{t.sources}</h2>
          {sources.length === 0 ? (
            <p className="micro">{t.noSources}</p>
          ) : (
            sources.map((s, i) => (
              <a className="source-row" key={s.href} href={s.href} target="_blank" rel="noopener noreferrer nofollow">
                <span className="source-n">0{i + 1}</span>
                <bdi>{s.host}</bdi>
                <Icon name="external" />
              </a>
            ))
          )}
        </section>
        <section className="aside-section next-panel">
          <h2>{t.nextReport}</h2>
          <p>{cause === null ? t.noCause : ar ? cause.detail.ar : cause.detail.en}</p>
          <button className="button primary" onClick={() => setTab('readiness')}>
            {t.plan}
            {arrow}
          </button>
        </section>
      </aside>
    </div>
  );

  const matrixView = (
    <section className="tab-content">
      <div className="tab-heading">
        <h2>{t.matrixTitle}</h2>
        <p>{t.matrixDesc}</p>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{t.matrixTitle}</caption>
          <thead>
            <tr>
              <th scope="col">{t.store}</th>
              {matrixEngines.map((e) => (
                <th scope="col" key={e}>
                  <bdi>{engineName(e)}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.name} className={row.isStore ? 'matrix-you' : ''}>
                <td>
                  <bdi>{row.isStore ? domain : row.name}</bdi>
                  {row.isStore && (
                    <>
                      <br />
                      <span className="micro">{t.you}</span>
                    </>
                  )}
                </td>
                {row.cells.map((c) => (
                  <td key={c.engine}>
                    <span className={`presence ${c.state === 'mentioned' ? 'yes' : 'no'}`}>
                      <Icon name={c.state === 'mentioned' ? 'check' : 'minus'} />
                      <span>{c.state === 'mentioned' ? t.yes : c.state === 'absent' ? t.no : t.notMeasured}</span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="technical-note">
        <Icon name="info" />
        {t.statusNote}
      </p>
    </section>
  );

  const readinessView = (
    <section className="tab-content">
      <div className="tab-heading">
        <h2>{t.fixes}</h2>
        <p>{t.fixDesc}</p>
      </div>
      <div className="summary-bar">
        <div className="summary-stat passed">
          <strong>{passedCount}</strong>
          <span>{t.passed}</span>
        </div>
        <div className="summary-stat needs">
          <strong>{needsCount}</strong>
          <span>{t.needs}</span>
        </div>
      </div>
      <div className="filter-tabs" role="group" aria-label={t.readiness}>
        {(['all', 'needs', 'passed'] as const).map((k) => (
          <button key={k} className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {t[k]}
          </button>
        ))}
      </div>
      <div className="rules-list">
        {[...rules.filter((r) => !r.passed), ...rules.filter((r) => r.passed)]
          .filter((r) => filter === 'all' || (filter === 'needs' ? !r.passed : r.passed))
          .map((r) => (
            <details className={`rule-row ${r.passed ? 'pass' : 'needs'}`} key={r.key}>
              <summary className="rule-summary">
                <Icon name={r.passed ? 'check' : 'info'} />
                <span>{ar ? r.detail.ar : r.detail.en}</span>
                <small>{r.passed ? t.passed : t.needs}</small>
                <Icon name="chevron" className="chevron" />
              </summary>
              <div className="rule-body">
                {r.evidence !== '' && <p className="rule-evidence">{r.evidence}</p>}
                {r.fixSnippet !== undefined && !r.passed && (
                  <>
                    <div className="code-label">
                      <span>{t.codeTitle}</span>
                      <button className="text-button" onClick={() => void copyText(r.fixSnippet ?? '')}>
                        <Icon name="copy" />
                        {t.copy}
                      </button>
                    </div>
                    <pre>
                      <code>{r.fixSnippet}</code>
                    </pre>
                  </>
                )}
              </div>
            </details>
          ))}
      </div>
      <p className="technical-note">
        <Icon name="info" />
        {t.technicalNote}
      </p>
    </section>
  );

  const securityView = (
    <section className="tab-content">
      <div className="tab-heading">
        <h2>{t.secTitle}</h2>
        <p>{t.secDesc}</p>
      </div>
      <div className="security-grid">
        {(scan?.security ?? []).length === 0 ? (
          <article className="security-card">
            <Icon name="shield" />
            <h3>{t.secClean}</h3>
            <p>{t.secCleanDetail}</p>
          </article>
        ) : (
          (scan?.security ?? []).map((f, i) => (
            <article className="security-card" key={`${f.kind}-${i}`}>
              <Icon name={f.kind === 'domain_expiry' ? 'clock' : f.kind.includes('key') || f.kind.includes('secret') ? 'lock' : 'shield'} />
              <h3>{ar ? f.title.ar : f.title.en}</h3>
              <p>{ar ? f.detail.ar : f.detail.en}</p>
              <span className="badge">{t.severity[f.severity as keyof typeof t.severity] ?? f.severity}</span>
            </article>
          ))
        )}
      </div>
    </section>
  );

  const report = (
    <main id="main" tabIndex={-1} className="container report-page page-enter">
      <div className="report-header">
        <div>
          <span className="eyebrow">{t.reportKick}</span>
          <h1>{t.reportTitle}</h1>
          <div className="report-meta">
            <bdi>{domain}</bdi>
            {demo && <span className="badge">{t.demoNote}</span>}
            {localeLine !== '' && scan !== null && <span className="locale">{localeLine}</span>}
          </div>
        </div>
        <div className="report-actions">
          {domain !== '' && domain !== '…' && (
            <button className="button secondary" onClick={() => void runScan(domain)}>
              <Icon name="refresh" />
              {t.rerun}
            </button>
          )}
          {scan !== null && (
            <button
              className="icon-btn"
              onClick={() => void copyText(`${window.location.origin}${window.location.pathname}?r=${encodeURIComponent(scan.id)}`)}
              aria-label={t.copyLink}
              title={t.copyLink}
            >
              <Icon name="copy" />
            </button>
          )}
        </div>
      </div>
      {failure !== null || scan === null ? (
        stateScreen(failure ?? 'error')
      ) : (
        <>
          <nav className="report-tabs" role="tablist" aria-label={t.report}>
            {(['evidence', 'matrix', 'readiness', 'security'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                id={`tab-${k}`}
                aria-controls="report-panel"
                tabIndex={tab === k ? 0 : -1}
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {k === 'evidence' ? t.evidence : t[k]}
              </button>
            ))}
          </nav>
          <div id="report-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
            {tab === 'evidence' ? evidence : tab === 'matrix' ? matrixView : tab === 'readiness' ? readinessView : securityView}
          </div>
          <button className="report-agent" onClick={() => toast(t.agentSoon)}>
            <Mark />
            <span>{t.agentAction}</span>
            <span className="badge">{t.coming}</span>
          </button>
          <p className="report-note">{t.reportNote}</p>
        </>
      )}
    </main>
  );

  return (
    <>
      <a className="skip-link" href="#main">
        {ar ? 'انتقل إلى المحتوى' : 'Skip to content'}
      </a>
      {header}
      {page === 'home' ? home : page === 'scan' ? scanPage : report}
      {footer}
      <div id="toast" role="status" aria-live="polite" className={toastOn ? 'show' : ''}>
        {toastText}
      </div>
    </>
  );
}
