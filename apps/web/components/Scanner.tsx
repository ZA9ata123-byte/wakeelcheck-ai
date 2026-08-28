'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineAnswer, ScanResult, SecurityFinding } from '@wakeelcheck/core';
import type { Copy } from '@/lib/i18n';

type Phase = 'idle' | 'scanning' | 'done' | 'error';

const STEP_MS = 900;
const POLL_MS = 1500;
const POLL_LIMIT = 60; // 90 ثانية سقفاً — بعدها نتوقّف بدل الدوران للأبد

/**
 * يقسم نص الإجابة عند أسماء المنافسين ليُظلَّل كل اسم.
 *
 * التظليل هو العلامة التجارية كلها، ولا يُوضع إلا على اسم عاد فعلاً من
 * الاستخراج — أي اسم تحقّقنا من وجوده حرفياً في النص.
 */
function markCompetitors(text: string, names: readonly string[]): React.ReactNode[] {
  if (names.length === 0) return [text];

  const escaped = names
    .filter((n) => n.length > 2)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length); // الأطول أولاً حتى لا يبتلع الأقصر جزءاً منه

  if (escaped.length === 0) return [text];

  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'));

  return parts.map((part, i) =>
    names.some((n) => n === part) ? (
      <mark className="rival" key={i} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function Alarm({ finding }: { finding: SecurityFinding }) {
  return (
    <div className="alarm rise" style={{ animationDelay: '.15s' }}>
      <span className="glyph">!</span>
      <div>
        <b>{finding.title.ar}</b>
        <p>{finding.detail.ar}</p>
      </div>
    </div>
  );
}

function Exhibit({
  answer,
  question,
  t,
  domain,
  topRival,
}: {
  answer: EngineAnswer;
  question: string;
  t: Copy;
  domain: string;
  topRival: string | null;
}) {
  const names = answer.competitors.map((c) => c.name);

  return (
    <div className="exhibit rise">
      <div className="ex-head">
        <span className="engine">{answer.engine === 'chatgpt' ? 'ChatGPT' : answer.engine}</span>
        <span className="q">«{question}»</span>
      </div>

      <div className="ex-body">{markCompetitors(answer.answerText, names)}</div>

      <div className="verdict">
        <div className="vt" data-tone={answer.storeMentioned ? 'good' : 'bad'}>
          <span className="lab">
            {t.yourStore} <span className="mono">{domain}</span>
          </span>
          <span className="val">{answer.storeMentioned ? '1 / 1' : '0 / 1'}</span>
          <span className="sub">{answer.storeMentioned ? t.mentioned : t.notMentioned}</span>
        </div>

        <div className="vt">
          <span className="lab">{t.topRival}</span>
          <span className="val">{names.length}</span>
          <span className="sub">{topRival ?? t.noRival}</span>
        </div>
      </div>
    </div>
  );
}

export default function Scanner({ t, locale }: { t: Copy; locale: 'ar' | 'en' }) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const poll = useCallback(async (scanId: string) => {
    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((resolve) => {
        const id = setTimeout(resolve, POLL_MS);
        timers.current.push(id);
      });

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
      if (phase === 'scanning') return;

      clearTimers();
      setPhase('scanning');
      setStep(0);
      setScan(null);
      setMessage(null);
      setSent(false);

      // العرض المسرحي: الانتظار المرئي يخلق قيمة مدركة. نتيجة تظهر فجأة
      // تُقرأ كجدول ثابت؛ نتيجة بعد أربع خطوات تُقرأ كعمل جرى فعلاً.
      for (let i = 1; i < t.steps.length; i++) {
        timers.current.push(setTimeout(() => setStep(i), i * STEP_MS));
      }

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        if (res.status === 429) {
          clearTimers();
          setPhase('error');
          setMessage(t.limitHit);
          return;
        }
        if (!res.ok) {
          clearTimers();
          setPhase('error');
          setMessage(t.unreachable);
          return;
        }

        const { scanId, demo: isDemo } = (await res.json()) as { scanId: string; demo?: boolean };
        setDemo(isDemo === true);

        const result = await poll(scanId);
        clearTimers();
        setScan(result);
        setPhase('done');
      } catch {
        clearTimers();
        setPhase('error');
        setMessage(t.unreachable);
      }
    },
    [clearTimers, phase, poll, t, url]
  );

  const sendLead = useCallback(async () => {
    if (!email.includes('@')) return;
    await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, scanId: scan?.id, locale }),
    });
    setSent(true);
  }, [email, locale, scan]);

  const answer = scan?.answers[0] ?? null;
  const question = scan?.questions.find((q) => q.id === answer?.questionId)?.text ?? '';
  const alarm = scan?.security[0] ?? null;

  return (
    <>
      <form className="probe" onSubmit={submit} autoComplete="off">
        <div className="probe-row">
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
          />
          <button className="go" type="submit" disabled={phase === 'scanning'}>
            {phase === 'scanning' ? t.ctaBusy : phase === 'done' ? t.ctaAgain : t.cta}
          </button>
        </div>
        <div className="micro">
          {t.micro.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </form>

      <div className="stage">
        {phase === 'scanning' && (
          <div className="steps">
            {t.steps.map((label, i) => (
              <div className="stp" key={label} data-state={i < step ? 'done' : i === step ? 'on' : 'idle'}>
                <span className="mk">▸</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}

        {phase === 'error' && message !== null && <div className="notice">{message}</div>}

        {phase === 'done' && scan !== null && (
          <>
            {demo && (
              <div className="notice">
                وضع تجريبي: الإجابات المعروضة نموذجية لأن مفاتيح المحرّكات غير مُعدّة بعد.
              </div>
            )}

            {answer !== null && (
              <Exhibit
                answer={answer}
                question={question}
                t={t}
                domain={scan.profile?.domain ?? ''}
                topRival={scan.shareOfVoice.top?.name ?? null}
              />
            )}

            {alarm !== null && <Alarm finding={alarm} />}

            <div className="gate rise" style={{ animationDelay: '.3s' }}>
              <h3>{t.gateTitle}</h3>
              <ul>
                {t.gateItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              {sent ? (
                <p className="fine">{t.gateDone}</p>
              ) : (
                <>
                  <div className="gate-row">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t.emailPlaceholder}
                      aria-label={t.emailPlaceholder}
                    />
                    <button type="button" onClick={() => void sendLead()}>
                      {t.gateCta}
                    </button>
                  </div>
                  <p className="fine">{t.gateFine}</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
