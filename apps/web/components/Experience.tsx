'use client';

/**
 * الشاشة — وفق الاتجاه البصري (docs/06) وتصميم المصمم.
 *
 * أربع حالات في مكان واحد: خانة، فحص جارٍ، نتيجة، إخفاق. لا تنقّل بين
 * صفحات، لأن اللحظة التي يبيعها المنتج واحدة ولا تحتمل انتظار تحميل.
 *
 * الفرق عن ملف التصميم: هنا لا توجد بيانات ثابتة. كل ما يُعرض بعد الفحص
 * يأتي من `/api/scan` — والعلامة لا تُوضع إلا على اسم عاد من الاستخراج،
 * وهو اسم تحقّق خطّ الأنابيب من وروده حرفياً في نص الإجابة.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineAnswer, ScanResult } from '@wakeelcheck/core';
import { copy, type Locale } from '@/lib/i18n';
import {
  ArrowNext,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy as CopyIcon,
  External,
  Globe,
  Menu,
  Search,
  Shield,
} from '@/components/icons';

type Phase = 'idle' | 'running' | 'result' | 'failed';

const ROBOTS_FIX = 'User-agent: GPTBot\nAllow: /';

/**
 * يضع العلامة على أسماء المنافسين داخل النص.
 *
 * الأطول أولاً حتى لا يبتلع اسم قصير جزءاً من اسم أطول.
 */
function markRivals(text: string, names: readonly string[]): React.ReactNode[] {
  const usable = [...new Set(names)].filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
  if (usable.length === 0) return [text];

  const escaped = usable.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'));

  return parts.map((part, i) =>
    usable.includes(part) ? (
      <mark className="rival" key={i} style={{ animationDelay: `${0.2 + i * 0.1}s` }}>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function engineLabel(engine: string): string {
  if (engine === 'chatgpt') return 'ChatGPT';
  if (engine === 'ai_overviews') return 'AI Overviews';
  if (engine === 'ai_mode') return 'AI Mode';
  if (engine === 'perplexity') return 'Perplexity';
  return engine;
}

function score(result: ScanResult): { pct: number; passed: number; total: number } {
  const total = result.rules.length;
  if (total === 0) return { pct: 0, passed: 0, total: 0 };
  const sum = result.rules.reduce((a, r) => a + r.weight, 0);
  const got = result.rules.reduce((a, r) => a + (r.passed ? r.weight : 0), 0);
  return { pct: sum === 0 ? 0 : Math.round((got / sum) * 100), passed: result.rules.filter((r) => r.passed).length, total };
}

export default function Experience({ locale }: { locale: Locale }) {
  const t = copy[locale];

  const [domain, setDomain] = useState('');
  const [shown, setShown] = useState('yourstore.sa');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [engineIdx, setEngineIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearInterval(id));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** يسأل عن النتيجة حتى تكتمل — العقد: POST يعود فوراً، وGET يسأل. */
  const poll = useCallback(async (scanId: string): Promise<ScanResult> => {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const res = await fetch(`/api/scan/${scanId}`);
      if (!res.ok) continue;
      const result = (await res.json()) as ScanResult;
      if (result.status === 'done') return result;
      if (result.status === 'failed') throw new Error(result.error ?? 'failed');
    }
    throw new Error('timeout');
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (phase === 'running') return;

      const cleaned = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (cleaned === '' || !cleaned.includes('.')) {
        setNotice(t.badDomain);
        setPhase('failed');
        return;
      }

      clearTimers();
      setNotice(null);
      setScan(null);
      setEngineIdx(0);
      setStep(0);
      setShown(cleaned);
      setPhase('running');

      // الخطوات تتقدّم بصرياً بينما يعمل الفحص فعلاً — لا تدّعي تقدّماً،
      // بل تسمّي المرحلة التي يمرّ بها خطّ الأنابيب.
      const tick = window.setInterval(() => setStep((s) => Math.min(s + 1, t.shortSteps.length - 1)), 4000);
      timers.current.push(tick);

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleaned }),
        });

        if (res.status === 429) {
          clearTimers();
          setNotice(t.limitHit);
          setPhase('failed');
          return;
        }
        if (!res.ok) {
          clearTimers();
          setNotice(t.unreachable);
          setPhase('failed');
          return;
        }

        const { scanId, demo: isDemo } = (await res.json()) as { scanId: string; demo?: boolean };
        setDemo(isDemo === true);

        const result = await poll(scanId);
        clearTimers();
        setScan(result);
        setPhase('result');
      } catch {
        clearTimers();
        setNotice(t.unreachable);
        setPhase('failed');
      }
    },
    [clearTimers, domain, phase, poll, t]
  );

  const answers: EngineAnswer[] = scan?.answers ?? [];
  const answer = answers[Math.min(engineIdx, Math.max(answers.length - 1, 0))] ?? null;
  const rivals = answer?.competitors.map((c) => c.name) ?? [];
  const question = scan?.questions.find((q) => q.id === answer?.questionId)?.text ?? null;
  const s = scan === null ? null : score(scan);
  const sov = scan?.shareOfVoice ?? null;

  return (
    <main id="top">
      {/* ── الشريط العلوي ─────────────────────────────── */}
      <nav className="topbar" aria-label={t.navHome}>
        <a href="#top" className="wordmark">
          وكيل تشيك<span>{t.brandTag}</span>
        </a>

        <div className={`nav-links${menuOpen ? ' open' : ''}`}>
          <a href="#top">{t.navHome}</a>
          <a href="#journey">{t.navHow}</a>
          <a href="#report">{t.navReport}</a>
          <a href="#pricing">{t.navPrice}</a>
        </div>

        <div className="nav-actions">
          <a className="language" href={t.otherHref}>
            <Globe size={16} /> {t.other} <ChevronDown size={14} />
          </a>
          <a className="nav-cta" href="#scanner">
            {t.navCta}
          </a>
          <button
            className="menu-button"
            type="button"
            aria-label={t.menuLabel}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={22} />
          </button>
        </div>
      </nav>

      {/* ── البطل والخانة ─────────────────────────────── */}
      <section className="hero" id="scanner">
        <div className="hero-copy">
          <p className="section-kicker">{t.kicker}</p>

          <h1>
            <span className="title-line">
              {t.titleA}
              <b dir="ltr">ChatGPT</b>
            </span>
            <span className="title-line">{t.titleB}</span>
          </h1>

          <p className="hero-lede">{t.sub}</p>

          <form className="domain-form" onSubmit={submit} noValidate>
            <label htmlFor="store-domain">{t.domainLabel}</label>
            <div className="domain-controls">
              <input
                id="store-domain"
                dir="ltr"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={t.placeholder}
                aria-invalid={phase === 'failed'}
                autoComplete="url"
                spellCheck={false}
              />
              <button type="submit" disabled={phase === 'running'}>
                {phase === 'running' ? t.ctaBusy : phase === 'result' ? t.ctaAgain : t.cta}
              </button>
            </div>

            {phase === 'failed' && notice !== null ? (
              <p className="form-error" role="alert">
                <CircleAlert size={15} /> {notice}
              </p>
            ) : (
              <div className="trust-row">
                {t.trust.map((item) => (
                  <span key={item}>
                    <Check size={14} /> {item}
                  </span>
                ))}
              </div>
            )}

            {demo && (
              <p className="demo-note">
                وضع تجريبي: لا مفاتيح مضبوطة، والبيانات المعروضة نموذجية.
              </p>
            )}
          </form>
        </div>

        {/* ── نافذة المنتج ────────────────────────────── */}
        <div className="product-scene" aria-live="polite">
          <div className="depth-layer depth-one" aria-hidden="true" />
          <div className="depth-layer depth-two" aria-hidden="true" />

          <article className="product-window">
            <header className="app-bar">
              <div className="app-domain" dir="ltr">
                <span className="live-dot" />
                {shown}
              </div>
              <div className="scan-meta">
                <span className="verified">
                  <Check size={13} /> {phase === 'running' ? t.scanning : scan === null ? t.sample : t.literalBadge}
                </span>
                <span>
                  <Clock size={13} />
                  {answer === null ? '—' : answer.capturedAt.slice(0, 16).replace('T', ' ')}
                </span>
              </div>
            </header>

            {answers.length > 1 && (
              <div className="engine-tabs" role="tablist" aria-label={t.navReport}>
                {answers.map((a, i) => (
                  <button
                    key={`${a.engine}-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={i === engineIdx}
                    className={i === engineIdx ? 'active' : ''}
                    onClick={() => setEngineIdx(i)}
                  >
                    {engineLabel(a.engine)}
                  </button>
                ))}
              </div>
            )}

            <ol className="scan-track" aria-label={t.navHow}>
              {t.shortSteps.map((label, i) => {
                const done = phase !== 'running' ? phase === 'result' : i < step;
                const now = phase === 'running' && i === step;
                return (
                  <li key={label} className={done ? 'complete' : now ? 'current' : ''}>
                    <span>{done ? <Check size={12} /> : i + 1}</span>
                    <small>{label}</small>
                  </li>
                );
              })}
            </ol>

            {phase === 'running' ? (
              <div className="live-scan">
                <div className="scan-beam" />
                <Search size={28} />
                <span className="mono-label">
                  STEP {String(step + 1).padStart(2, '0')} / {String(t.shortSteps.length).padStart(2, '0')}
                </span>
                <h2>{t.shortSteps[step]}</h2>
                <p>{t.liveNote}</p>
              </div>
            ) : (
              <>
                <div className="evidence-head">
                  <div>
                    <span className="mono-label">{t.evidenceKicker}</span>
                    <h2>{t.evidenceTitle}</h2>
                  </div>
                  <span className="literal-badge">
                    <Shield size={14} /> {t.literalBadge}
                  </span>
                </div>

                <div className="transcript" key={engineIdx}>
                  <div className="question">
                    <span>{t.userQuestion}</span>
                    <p>{question ?? t.placeholderQuestion}</p>
                  </div>
                  <div className="answer">
                    <span>{answer === null ? 'ChatGPT' : engineLabel(answer.engine)}</span>
                    <blockquote>
                      {answer === null ? t.sampleAnswer : markRivals(answer.answerText, rivals)}
                    </blockquote>
                  </div>
                </div>

                <div className="result-rail">
                  <div className={answer?.storeMentioned === true ? '' : 'result-negative'}>
                    <span>{t.yourStore}</span>
                    <b dir="ltr">{answer === null ? '0 / 1' : answer.storeMentioned ? '1 / 1' : '0 / 1'}</b>
                    <small>{answer?.storeMentioned === true ? t.mentioned : t.notMentioned}</small>
                  </div>
                  <div>
                    <span>{t.firstRival}</span>
                    <b>{rivals[0] ?? sov?.top?.name ?? '—'}</b>
                    <small>{rivals.length === 0 ? t.noRival : t.namedInstead}</small>
                  </div>
                  <div className={sov !== null && sov.store === 0 ? 'result-negative' : ''}>
                    <span>{t.shareLabel}</span>
                    <b dir="ltr">
                      {sov === null || sov.total === 0 ? '0%' : `${Math.round((sov.store / sov.total) * 100)}%`}
                    </b>
                    <small>{t.inThisAnswer}</small>
                  </div>
                </div>

                <footer className="evidence-footer">
                  <span>
                    <Shield size={14} /> {t.evidenceFoot}
                  </span>
                  <a href="#diagnosis">
                    {t.seeCause} <ArrowNext size={15} />
                  </a>
                </footer>
              </>
            )}
          </article>
        </div>
      </section>

      {/* ── من الدليل إلى الإصلاح ─────────────────────── */}
      <section className="journey" id="journey">
        <div className="journey-heading">
          <span className="mono-label">{t.journeyKicker}</span>
          <h2>{t.journeyTitle}</h2>
          <p>{t.journeyLede}</p>
        </div>

        <div className="causal-flow">
          <article>
            <i>01</i>
            <span>{t.causeSteps[0].tag}</span>
            <h3>{t.causeSteps[0].title}</h3>
            <p>
              «… <mark className="rival">{rivals[0] ?? t.sampleRival}</mark> …»
            </p>
          </article>

          <article className="cause-card">
            <i>02</i>
            <span>{t.causeSteps[1].tag}</span>
            <h3>{t.causeSteps[1].title}</h3>
            <code dir="ltr">GPTBot → blocked</code>
          </article>

          <article className="fix-card">
            <i>03</i>
            <span>{t.causeSteps[2].tag}</span>
            <h3>{t.causeSteps[2].title}</h3>
            <pre dir="ltr">
              <code>{ROBOTS_FIX}</code>
            </pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(ROBOTS_FIX).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              <CopyIcon size={15} /> {copied ? t.copied : t.copyCode}
            </button>
          </article>
        </div>

        <div className="report-tabs" id="report">
          <button type="button" className="active">
            <Search size={17} /> {t.navReport}
          </button>
          <button type="button">
            <Check size={17} /> {t.readinessTitle}
          </button>
          <button type="button">
            <Shield size={17} /> {t.securityTab}
          </button>
          <button type="button">
            <External size={17} /> {t.paidName}
          </button>
        </div>
      </section>

      {/* ── التقرير ───────────────────────────────────── */}
      <section className="report-section" id="diagnosis">
        <div className="report-copy">
          <span className="mono-label">{t.reportKicker}</span>
          <h2>{t.reportTitle}</h2>
          <p>{t.reportLede}</p>
          <a href="#pricing">
            {t.seeMonitoring} <ArrowNext size={16} />
          </a>
        </div>

        <div className="readiness-panel">
          <header>
            <span>{t.readinessTitle}</span>
            <b dir="ltr">{s === null ? '— / 20' : `${s.passed} / ${s.total}`}</b>
          </header>
          <div className="score-line">
            <span style={{ width: `${s?.pct ?? 0}%` }} />
          </div>
          <ul>
            {(scan?.rules ?? []).slice(0, 4).map((rule) => (
              <li key={rule.key}>
                <span className={`rule-state ${rule.passed ? 'passed' : 'failed'}`}>
                  {rule.passed ? t.rulePassed : t.ruleFailed}
                </span>
                <div>
                  <b>{rule.key}</b>
                  <small>{locale === 'ar' ? rule.detail.ar : rule.detail.en}</small>
                </div>
                <code dir="ltr">weight {rule.weight}</code>
              </li>
            ))}
            {scan === null && <li className="rules-empty">{t.rulesEmpty}</li>}
          </ul>
        </div>
      </section>

      {/* ── السعر ─────────────────────────────────────── */}
      <section className="pricing" id="pricing">
        <div>
          <span className="mono-label">{t.priceKicker}</span>
          <h2>
            {t.priceTitleA}
            <br />
            {t.priceTitleB}
          </h2>
          <p>{t.priceLede}</p>
        </div>

        <article className="price-card">
          <header>
            <span>{t.paidName}</span>
            <strong>
              <b>{t.paidPrice}</b>
              {t.paidUnit}
            </strong>
          </header>
          <ul>
            {t.paidItems.map((item) => (
              <li key={item}>
                <Check size={16} /> {item}
              </li>
            ))}
          </ul>
          <a href="#scanner">
            {t.startFree} <ArrowNext size={17} />
          </a>
        </article>
      </section>

      <footer className="site-footer">
        <div>
          <strong>وكيل تشيك</strong>
          <p>{t.footerLine}</p>
        </div>
        <div className="footer-links">
          <a href="#journey">{t.navHow}</a>
          <a href="#report">{t.navReport}</a>
          <a href="#pricing">{t.navPrice}</a>
        </div>
        <span dir="ltr">AR · EN / 2026</span>
      </footer>
    </main>
  );
}
