/**
 * البريد — النشرة الأسبوعية إلى المشترك، عبر Resend.
 *
 * ## لماذا Resend
 *
 * واجهة HTTP واحدة بلا مكتبة، تعمل من دالةٍ تعيش ثوانٍ، ومجانية حتى حجمٍ
 * يتجاوز ما نحتاجه طويلاً. والمرسِل عنوانٌ على نطاقنا بعد التحقّق منه هناك.
 *
 * ## ما لا يُكتب
 *
 * لا مفتاح ولا بريد في رسالة خطأ ولا في سجلّ — القاعدة 01. الخطأ يحمل رمز
 * الحالة وحده.
 */

import type { Digest, DigestTone } from '@wakeelcheck/core';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

export class MailUnavailableError extends Error {
  constructor(detail: string) {
    super(`mail unavailable: ${detail}`);
    this.name = 'MailUnavailableError';
  }
}

const RESEND = 'https://api.resend.com/emails';

export interface ResendOptions {
  apiKey: string;
  /** `وكيل تشيك <report@aitchek.online>` — عنوانٌ على نطاقٍ تحقّق منه Resend. */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function resendMailer(opts: ResendOptions): Mailer {
  const send = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return async (mail) => {
    let res: Response;
    try {
      res = await send(RESEND, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new MailUnavailableError(err instanceof Error ? err.name : 'network');
    }
    if (!res.ok) throw new MailUnavailableError(`HTTP ${res.status}`);
  };
}

type Env = (name: string) => string | undefined;

/** المرسِل من البيئة، أو `null` حين ينقص المفتاح أو العنوان. */
export function mailerFromEnv(env: Env, fetchImpl?: typeof fetch): Mailer | null {
  const apiKey = env('RESEND_API_KEY')?.trim();
  const from = env('MAIL_FROM')?.trim();
  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') return null;
  return resendMailer(fetchImpl === undefined ? { apiKey, from } : { apiKey, from, fetch: fetchImpl });
}

// ── النشرة ───────────────────────────────────────────────────

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** رابط التقرير — العربية في الجذر، والإنجليزية في `/en`. */
export function reportUrl(site: string, id: string, locale: 'ar' | 'en'): string {
  const base = site.replace(/\/+$/, '');
  return `${base}${locale === 'en' ? '/en' : '/'}?r=${encodeURIComponent(id)}`;
}

/** لونٌ لكلّ نبرة — في البريد لا رموز CSS، فالقيم هنا وحدها. */
const TONE_COLOR: Record<DigestTone, string> = {
  alert: '#ae2931',
  good: '#12644c',
  quiet: '#536780',
  incomparable: '#885704',
  baseline: '#215fc8',
};

const COPY = {
  ar: {
    week: 'نشرة الأسبوع',
    open: 'افتح التقرير الكامل',
    basis: 'على ماذا بُني هذا',
    why: 'وصلتك لأنك مشترك في المتابعة الأسبوعية لـ',
    manage: 'لإيقاف الاشتراك: من رابط الإدارة في إيصال Lemon Squeezy.',
  },
  en: {
    week: 'Your weekly digest',
    open: 'Open the full report',
    basis: 'What this is based on',
    why: 'You get this because you subscribe to weekly monitoring for',
    manage: 'To cancel: use the manage link in your Lemon Squeezy receipt.',
  },
} as const;

export function digestEmail(
  digest: Digest,
  opts: { to: string; domain: string; url: string; locale: 'ar' | 'en' }
): Mail {
  const l = opts.locale;
  const c = COPY[l];
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const headline = digest.headline[l];
  const lines = digest.lines.map((line) => line[l]);
  const basis = digest.basis[l];
  const color = TONE_COLOR[digest.tone];

  const html = `<!doctype html><html lang="${l}" dir="${dir}"><body style="margin:0;background:#f4f7fc;font-family:Tahoma,Arial,sans-serif;color:#10203d">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="margin:0 0 6px;font-size:13px;color:#536780">${c.week} · <bdi>${escape(opts.domain)}</bdi></p>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.5;color:${color}">${escape(headline)}</h1>
${lines.length > 0 ? `<ul style="margin:0 0 20px;padding-inline-start:20px;font-size:15px;line-height:1.8">${lines.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>` : ''}
<p style="margin:0 0 24px"><a href="${escape(opts.url)}" style="display:inline-block;background:#2465f5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">${c.open}</a></p>
<p style="margin:0 0 4px;font-size:13px;color:#536780">${c.basis}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.7">${escape(basis)}</p>
<hr style="border:0;border-top:1px solid #d0ddee;margin:0 0 14px">
<p style="margin:0;font-size:12px;color:#536780">${c.why} <bdi>${escape(opts.domain)}</bdi>. ${c.manage}</p>
</div></body></html>`;

  const text = [
    `${c.week} · ${opts.domain}`,
    '',
    headline,
    ...lines.map((x) => `- ${x}`),
    '',
    `${c.open}: ${opts.url}`,
    '',
    `${c.basis}: ${basis}`,
    '',
    `${c.why} ${opts.domain}. ${c.manage}`,
  ].join('\n');

  return { to: opts.to, subject: `${headline} · ${opts.domain}`, html, text };
}
