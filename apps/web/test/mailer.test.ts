import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Digest } from '@wakeelcheck/core';
import type { Recipient, SubscriptionLedger } from '@wakeelcheck/db';
import { MailUnavailableError, digestEmail, mailerFromEnv, reportUrl, resendMailer, type Mail } from '../lib/mailer';
import { notifyDigest } from '../lib/notify';

/**
 * النشرة بالبريد: تصل بلغة المشترك، برابط تقريره، ولا يمرّ فيها نصٌّ خام
 * بلا تهريب. وفشل رسالةٍ لا يُسقط الباقي.
 */

// قيمةٌ تشبه مفتاحاً تُبنى وقت التشغيل — حارس CI يرفضها نصّاً.
const KEY = ['test', 'resend', 'key'].join('-');

const DIGEST: Digest = {
  tone: 'alert',
  headline: { ar: 'اختفيت من إجابة Google AI Mode', en: 'You dropped out of a Google AI Mode answer' },
  lines: [{ ar: 'ظهر «<b>Perfumes Kuwait</b>» مكانك', en: '"<b>Perfumes Kuwait</b>" appeared instead' }],
  basis: { ar: '3 أسئلة × 4 محرّكات', en: '3 questions × 4 engines' },
};

// ── الرسالة ──────────────────────────────────────────────────

test('الرسالة بالعربية: اتجاهٌ ورابطٌ وعنوانٌ من النشرة', () => {
  const m = digestEmail(DIGEST, { to: 'a@b.example', domain: 'noura.sa', url: 'https://aitchek.online/?r=r1', locale: 'ar' });
  assert.equal(m.to, 'a@b.example');
  assert.match(m.subject, /اختفيت من إجابة Google AI Mode/);
  assert.match(m.subject, /noura\.sa/);
  assert.match(m.html, /dir="rtl"/);
  assert.match(m.html, /href="https:\/\/aitchek\.online\/\?r=r1"/);
  assert.match(m.text, /https:\/\/aitchek\.online\/\?r=r1/);
});

test('بالإنجليزية لمن اشترك بها', () => {
  const m = digestEmail(DIGEST, { to: 'a@b.example', domain: 'noura.sa', url: 'u', locale: 'en' });
  assert.match(m.html, /dir="ltr"/);
  assert.match(m.subject, /You dropped out/);
});

test('النصّ من القياس يُهرَّب — لا وسوم تمرّ إلى البريد', () => {
  const m = digestEmail(DIGEST, { to: 'a@b.example', domain: 'noura.sa', url: 'u', locale: 'ar' });
  assert.doesNotMatch(m.html, /<b>Perfumes/);
  assert.match(m.html, /&lt;b&gt;Perfumes/);
});

test('رابط التقرير: العربية في الجذر والإنجليزية في /en', () => {
  assert.equal(reportUrl('https://aitchek.online/', 'r 1', 'ar'), 'https://aitchek.online/?r=r%201');
  assert.equal(reportUrl('https://aitchek.online', 'r1', 'en'), 'https://aitchek.online/en?r=r1');
});

// ── الإرسال ──────────────────────────────────────────────────

test('Resend: طلبٌ واحد بالمفتاح والمرسِل والمستلم', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = resendMailer({
    apiKey: KEY,
    from: 'وكيل تشيك <report@aitchek.online>',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"id":"x"}', { status: 200 });
    },
  });
  await send({ to: 'a@b.example', subject: 's', html: 'h', text: 't' });
  assert.equal(calls[0]?.url, 'https://api.resend.com/emails');
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), `Bearer ${KEY}`);
  const body = JSON.parse(String(calls[0]?.init.body)) as { to: string[]; from: string };
  assert.deepEqual(body.to, ['a@b.example']);
  assert.equal(body.from, 'وكيل تشيك <report@aitchek.online>');
});

test('رفضٌ من Resend: خطأٌ برمز الحالة وحده — لا مفتاح ولا بريد', async () => {
  const send = resendMailer({ apiKey: KEY, from: 'x@y.example', fetch: async () => new Response('no', { status: 403 }) });
  await assert.rejects(send({ to: 'a@b.example', subject: 's', html: 'h', text: 't' }), (err: unknown) => {
    assert.ok(err instanceof MailUnavailableError);
    assert.doesNotMatch(err.message, new RegExp(KEY));
    assert.doesNotMatch(err.message, /a@b\.example/);
    assert.match(err.message, /403/);
    return true;
  });
});

test('بلا مفتاح أو بلا مرسِل: لا مُرسِل', () => {
  assert.equal(mailerFromEnv(() => undefined), null);
  assert.equal(mailerFromEnv((n) => (n === 'RESEND_API_KEY' ? KEY : undefined)), null);
  assert.equal(mailerFromEnv((n) => (n === 'MAIL_FROM' ? 'x@y.example' : undefined)), null);
  assert.notEqual(mailerFromEnv((n) => (n === 'RESEND_API_KEY' ? KEY : 'x@y.example')), null);
});

// ── لمن تُرسل ────────────────────────────────────────────────

function ledger(list: Recipient[]): SubscriptionLedger & { asked: unknown[][] } {
  const asked: unknown[][] = [];
  return {
    asked,
    async apply(s) {
      return s;
    },
    async get() {
      return null;
    },
    async recipients(domain, statuses) {
      asked.push([domain, statuses]);
      return list;
    },
  };
}

const MEASURED = { domain: 'noura.sa', reportId: 'r1', digest: DIGEST };

test('لكلّ مشترك رسالته بلغته ورابطه', async () => {
  const sent: Mail[] = [];
  const l = ledger([
    { email: 'a@b.example', locale: 'ar' },
    { email: 'c@d.example', locale: 'en' },
  ]);
  const r = await notifyDigest(MEASURED, {
    ledger: l,
    mailer: async (m) => {
      sent.push(m);
    },
    site: 'https://aitchek.online',
  });
  assert.deepEqual(r, { sent: 2, failed: 0 });
  assert.match(sent[0]?.text ?? '', /aitchek\.online\/\?r=r1/);
  assert.match(sent[1]?.text ?? '', /aitchek\.online\/en\?r=r1/);
  assert.deepEqual(l.asked[0]?.[1], ['on_trial', 'active', 'past_due', 'cancelled'], 'المستحقّون وحدهم');
});

test('فشل رسالةٍ لا يُسقط التي بعدها', async () => {
  let n = 0;
  const r = await notifyDigest(MEASURED, {
    ledger: ledger([
      { email: 'a@b.example', locale: 'ar' },
      { email: 'c@d.example', locale: 'ar' },
    ]),
    mailer: async () => {
      n += 1;
      if (n === 1) throw new MailUnavailableError('HTTP 500');
    },
    site: 'https://aitchek.online',
  });
  assert.deepEqual(r, { sent: 1, failed: 1 });
});

test('بلا مُرسِل أو بلا مشتركين: لا شيء يُرسل، ويُقال لماذا', async () => {
  assert.equal((await notifyDigest(MEASURED, { ledger: ledger([]), mailer: null, site: 's' })).skipped, 'no_mailer');
  assert.equal((await notifyDigest(MEASURED, { ledger: null, mailer: async () => {}, site: 's' })).skipped, 'no_ledger');
  assert.equal(
    (await notifyDigest(MEASURED, { ledger: ledger([]), mailer: async () => {}, site: 's' })).skipped,
    'no_recipients'
  );
});
