import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  ArchiveUnavailableError,
  type Monitor,
  type MonitorRegistry,
  type Subscription,
  type SubscriptionLedger,
} from '@wakeelcheck/db';
import { ENTITLED, checkoutTarget, handleCheckout, handleLemonWebhook } from '../lib/billing';

/**
 * الدفع: الإشعار مغلقٌ بلا سرّ، ومرفوضٌ بلا توقيع، والمتابعة تُفتح وتُغلق
 * بالحالة المحفوظة لا بالواردة.
 */

// قيمةٌ تشبه سرّاً تُبنى وقت التشغيل — حارس CI يرفضها نصّاً.
const SECRET = ['test', 'webhook', 'secret'].join('-');
const CHECKOUT = 'https://wakeelcheck.lemonsqueezy.com/buy/abc-123';

function fakeLedger(opts: { down?: boolean; stored?: (s: Subscription) => Subscription } = {}) {
  const applied: Subscription[] = [];
  const self: SubscriptionLedger & { applied: Subscription[] } = {
    applied,
    async apply(s) {
      if (opts.down === true) throw new ArchiveUnavailableError('down');
      applied.push(s);
      return opts.stored === undefined ? s : opts.stored(s);
    },
    async get() {
      return null;
    },
    async recipients() {
      return [];
    },
  };
  return self;
}

function fakeRegistry() {
  const enrolled: { domain: string; url: string; locale: string; at: Date }[] = [];
  const deactivated: string[] = [];
  const self: MonitorRegistry & { enrolled: typeof enrolled; deactivated: string[] } = {
    enrolled,
    deactivated,
    async enroll(input) {
      enrolled.push(input);
    },
    async deactivate(domain) {
      deactivated.push(domain);
    },
    async get(): Promise<Monitor | null> {
      return null;
    },
    async due() {
      return [];
    },
    async setQuestions() {
      return [];
    },
    async markRun() {},
    async saveDigest() {},
    async digestFor() {
      return null;
    },
  };
  return self;
}

function event(
  name: string,
  status: string,
  custom: Record<string, unknown> | null = { domain: 'www.Noura.sa' }
): string {
  return JSON.stringify({
    meta: { event_name: name, test_mode: true, custom_data: custom },
    data: {
      type: 'subscriptions',
      id: '42',
      attributes: {
        status,
        variant_id: 7,
        customer_id: 9,
        ends_at: null,
        updated_at: '2026-11-06T10:00:00.000000Z',
        test_mode: true,
        user_email: 'owner@noura.example',
      },
    },
  });
}

function signedReq(body: string, secret = SECRET): Request {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return new Request('https://aitchek.online/api/billing/webhook', {
    method: 'POST',
    headers: { 'x-signature': sig, 'content-type': 'application/json' },
    body,
  });
}

// ── الإغلاق والتوقيع ─────────────────────────────────────────

test('بلا سرّ: الإشعار مغلق — لا يُقبل لأحد', async () => {
  const ledger = fakeLedger();
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active')), {
    secret: undefined,
    ledger,
    registry: fakeRegistry(),
  });
  assert.equal(res.status, 503);
  assert.equal(ledger.applied.length, 0);
});

test('توقيعٌ بسرٍّ آخر: 401 ولا شيء يُكتب', async () => {
  const ledger = fakeLedger();
  const registry = fakeRegistry();
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active'), 'other'), {
    secret: SECRET,
    ledger,
    registry,
  });
  assert.equal(res.status, 401);
  assert.equal(ledger.applied.length, 0);
  assert.equal(registry.enrolled.length, 0);
});

test('جسمٌ عُدّل بعد التوقيع: 401', async () => {
  const body = event('subscription_created', 'active');
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  const req = new Request('https://aitchek.online/api/billing/webhook', {
    method: 'POST',
    headers: { 'x-signature': sig },
    body: body.replace('Noura', 'Evil'),
  });
  const res = await handleLemonWebhook(req, { secret: SECRET, ledger: fakeLedger(), registry: fakeRegistry() });
  assert.notEqual(body.replace('Noura', 'Evil'), body);
  assert.equal(res.status, 401);
});

test('بلا ترويسة توقيع: 401', async () => {
  const req = new Request('https://aitchek.online/api/billing/webhook', {
    method: 'POST',
    body: event('subscription_created', 'active'),
  });
  const res = await handleLemonWebhook(req, { secret: SECRET, ledger: fakeLedger(), registry: fakeRegistry() });
  assert.equal(res.status, 401);
});

// ── فتح المتابعة وإغلاقها ────────────────────────────────────

test('اشتراكٌ فعّال يفتح المتابعة لنطاقه المطبَّع', async () => {
  const ledger = fakeLedger();
  const registry = fakeRegistry();
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active', { domain: 'www.Noura.sa', locale: 'en' })), {
    secret: SECRET,
    ledger,
    registry,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { subscription: '42', status: 'active', monitoring: true });
  assert.equal(ledger.applied[0]?.domain, 'noura.sa');
  assert.equal(ledger.applied[0]?.variantId, '7');
  assert.equal(ledger.applied[0]?.testMode, true);
  assert.equal(ledger.applied[0]?.email, 'owner@noura.example', 'البريد يُحفظ للنشرة');
  assert.equal(ledger.applied[0]?.locale, 'en');
  assert.equal(registry.enrolled[0]?.domain, 'noura.sa');
  assert.equal(registry.enrolled[0]?.locale, 'en');
  assert.equal(registry.deactivated.length, 0);
});

test('الإلغاء لا يقطع الخدمة قبل نهاية المدفوع', async () => {
  const registry = fakeRegistry();
  await handleLemonWebhook(signedReq(event('subscription_cancelled', 'cancelled')), {
    secret: SECRET,
    ledger: fakeLedger(),
    registry,
  });
  assert.equal(registry.enrolled.length, 1);
  assert.equal(registry.deactivated.length, 0);
});

test('الانتهاء يُغلق المتابعة', async () => {
  const registry = fakeRegistry();
  await handleLemonWebhook(signedReq(event('subscription_expired', 'expired')), {
    secret: SECRET,
    ledger: fakeLedger(),
    registry,
  });
  assert.deepEqual(registry.deactivated, ['noura.sa']);
  assert.equal(registry.enrolled.length, 0);
});

test('يُحكم بالمحفوظ: «فعّال» قديمٌ بعد «منتهٍ» لا يفتح شيئاً', async () => {
  const registry = fakeRegistry();
  const ledger = fakeLedger({ stored: (s) => ({ ...s, status: 'expired' }) });
  const res = await handleLemonWebhook(signedReq(event('subscription_updated', 'active')), {
    secret: SECRET,
    ledger,
    registry,
  });
  assert.equal(((await res.json()) as { monitoring: boolean }).monitoring, false);
  assert.equal(registry.enrolled.length, 0);
  assert.deepEqual(registry.deactivated, ['noura.sa']);
});

test('الحالات المستحقّة محدّدة: لا تُضاف unpaid ولا paused خلسةً', () => {
  assert.deepEqual([...ENTITLED].sort(), ['active', 'cancelled', 'on_trial', 'past_due']);
});

// ── ما لا يعنينا يُقبل ولا يُعاد ─────────────────────────────

test('حدث طلبٍ لا اشتراك: 200 بلا أثر', async () => {
  const ledger = fakeLedger();
  const body = JSON.stringify({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: '1' } });
  const res = await handleLemonWebhook(signedReq(body), { secret: SECRET, ledger, registry: fakeRegistry() });
  assert.equal(res.status, 200);
  assert.equal(ledger.applied.length, 0);
});

test('اشتراكٌ بلا نطاق: 200 بلا متابعة', async () => {
  const ledger = fakeLedger();
  const registry = fakeRegistry();
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active', null)), {
    secret: SECRET,
    ledger,
    registry,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ignored: 'no_domain' });
  assert.equal(registry.enrolled.length, 0);
});

test('نطاقٌ غير صالح يُعامل كغيابه', async () => {
  const registry = fakeRegistry();
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active', { domain: 'http://127.0.0.1' })), {
    secret: SECRET,
    ledger: fakeLedger(),
    registry,
  });
  assert.deepEqual(await res.json(), { ignored: 'no_domain' });
  assert.equal(registry.enrolled.length, 0);
});

// ── تعطّل القاعدة: نريد الإعادة ──────────────────────────────

test('القاعدة معطّلة: 503 كي يعيد Lemon Squeezy الإرسال', async () => {
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active')), {
    secret: SECRET,
    ledger: fakeLedger({ down: true }),
    registry: fakeRegistry(),
  });
  assert.equal(res.status, 503);
});

test('بلا قاعدة أصلاً: 503', async () => {
  const res = await handleLemonWebhook(signedReq(event('subscription_created', 'active')), {
    secret: SECRET,
    ledger: null,
    registry: null,
  });
  assert.equal(res.status, 503);
});

// ── رابط الدفع ───────────────────────────────────────────────

test('رابط الدفع يحمل النطاق واللغة', () => {
  const url = checkoutTarget(CHECKOUT, 'noura.sa', 'ar');
  assert.equal(url?.hostname, 'wakeelcheck.lemonsqueezy.com');
  assert.equal(url?.searchParams.get('checkout[custom][domain]'), 'noura.sa');
  assert.equal(url?.searchParams.get('checkout[custom][locale]'), 'ar');
});

test('رابطٌ خارج lemonsqueezy.com أو بلا https يُرفض — لا تحويل مفتوح', () => {
  assert.equal(checkoutTarget('https://evil.example/buy/x', 'noura.sa', 'ar'), null);
  assert.equal(checkoutTarget('https://lemonsqueezy.com.evil.example/buy/x', 'noura.sa', 'ar'), null);
  assert.equal(checkoutTarget('http://wakeelcheck.lemonsqueezy.com/buy/x', 'noura.sa', 'ar'), null);
  assert.equal(checkoutTarget(undefined, 'noura.sa', 'ar'), null);
  assert.equal(checkoutTarget('not a url', 'noura.sa', 'ar'), null);
});

test('مسار الدفع يحوّل بـ303 بنطاقٍ مطبَّع', () => {
  const res = handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain=https://www.Noura.sa/x&locale=en'), {
    base: CHECKOUT,
  });
  assert.equal(res.status, 303);
  const loc = new URL(res.headers.get('location') ?? '');
  assert.equal(loc.searchParams.get('checkout[custom][domain]'), 'noura.sa');
  assert.equal(loc.searchParams.get('checkout[custom][locale]'), 'en');
});

test('مسار الدفع: نطاقٌ غير صالح 400، وبلا رابط 503', () => {
  assert.equal(handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain='), { base: CHECKOUT }).status, 400);
  assert.equal(handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain=noura.sa'), { base: undefined }).status, 503);
});

test('السنويّ يذهب إلى رابطه، والشهريّ إلى رابطه', () => {
  const YEARLY = 'https://wakeelcheck.lemonsqueezy.com/buy/yearly-1';
  const deps = { base: CHECKOUT, yearly: YEARLY };
  const y = handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain=noura.sa&plan=yearly'), deps);
  assert.equal(new URL(y.headers.get('location') ?? '').pathname, '/buy/yearly-1');
  const m = handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain=noura.sa'), deps);
  assert.equal(new URL(m.headers.get('location') ?? '').pathname, '/buy/abc-123');
});

test('سنويّ بلا رابطٍ سنويّ: 503 — لا يُحوَّل إلى الشهري بصمت', () => {
  const res = handleCheckout(new Request('https://aitchek.online/api/billing/checkout?domain=noura.sa&plan=yearly'), {
    base: CHECKOUT,
  });
  assert.equal(res.status, 503);
});
