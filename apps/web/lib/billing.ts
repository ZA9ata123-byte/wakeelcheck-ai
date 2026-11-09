/**
 * الدفع عبر Lemon Squeezy — منطقه بلا Next.
 *
 * مساران:
 *
 * - **الدفع:** `/api/billing/checkout?domain=…` يحوّل التاجر إلى صفحة الدفع
 *   المستضافة عند Lemon Squeezy، ونطاقُ متجره محمولٌ فيها `custom_data`.
 *   لا مفتاح API هنا: الرابط عامّ، ولا سرّ يُحمل.
 * - **الإشعار:** Lemon Squeezy يُبلغنا بكلّ تغيّر في الاشتراك. نتحقّق من
 *   توقيعه على **النصّ الخام** قبل أيّ قراءة، ثم نحفظ الحالة ونفتح المتابعة
 *   أو نغلقها.
 *
 * مغلقٌ ما لم يُضبط سرّه، كالمهمّة المجدولة: غيابُ `LEMONSQUEEZY_WEBHOOK_SECRET`
 * يعني أن لا إشعار يُقبل، لا أن كلّ إشعار يُقبل.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ArchiveUnavailableError,
  type MonitorRegistry,
  type SubscriptionLedger,
} from '@wakeelcheck/db';
import { normalizeUrl } from '@wakeelcheck/fetcher';

/**
 * الحالات التي يُتابَع فيها المتجر.
 *
 * `cancelled` منها: الإلغاء عند Lemon Squeezy يعني «لا تجديد»، والمدفوع
 * يبقى حتى `ends_at` — ثم يصل `expired`. و`past_due` منها: مهلة إعادة
 * محاولة الخصم، لا نقطع الخدمة في أوّل بطاقة مرفوضة.
 */
export const ENTITLED: ReadonlySet<string> = new Set(['on_trial', 'active', 'past_due', 'cancelled']);

/** نطاقُ متجر لا عنوان IP: المتابعة تُشترى لمتجر له اسم. */
function domainOf(input: string): string | null {
  let host: string;
  try {
    host = normalizeUrl(input).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  return host;
}

// ── الدفع ────────────────────────────────────────────────────

/**
 * رابط الدفع المستضاف — يُقبل من Lemon Squeezy وحده. خطأٌ في الإعداد لا
 * يصير تحويلاً مفتوحاً إلى أيّ موقع.
 */
export function checkoutTarget(base: string | undefined, domain: string, locale: 'ar' | 'en'): URL | null {
  if (base === undefined || base.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'lemonsqueezy.com' && !url.hostname.endsWith('.lemonsqueezy.com')) return null;
  url.searchParams.set('checkout[custom][domain]', domain);
  url.searchParams.set('checkout[custom][locale]', locale);
  return url;
}

export interface CheckoutDeps {
  /** `LEMONSQUEEZY_CHECKOUT_URL` — الشهري. */
  base: string | undefined;
  /** `LEMONSQUEEZY_CHECKOUT_URL_YEARLY` — السنوي. اختياريّ. */
  yearly?: string | undefined;
}

/**
 * `plan=yearly` يذهب إلى رابط السنوي وحده. وبلا رابطٍ سنويّ يُرفض — لا
 * يُحوَّل إلى الشهري بصمت، فيدفع التاجر غير ما اختاره.
 */
export function handleCheckout(req: Request, deps: CheckoutDeps): Response {
  const params = new URL(req.url).searchParams;
  const domain = domainOf(params.get('domain') ?? '');
  if (domain === null) return Response.json({ error: 'invalid_domain' }, { status: 400 });

  const locale = params.get('locale') === 'en' ? 'en' : 'ar';
  const base = params.get('plan') === 'yearly' ? deps.yearly : deps.base;
  const target = checkoutTarget(base, domain, locale);
  if (target === null) return Response.json({ error: 'billing_disabled' }, { status: 503 });

  return new Response(null, { status: 303, headers: { location: target.toString() } });
}

// ── الإشعار ──────────────────────────────────────────────────

export interface WebhookDeps {
  /** `LEMONSQUEEZY_WEBHOOK_SECRET` — يُكتب في لوحة Lemon Squeezy وفي Vercel، لا غير. */
  secret: string | undefined;
  ledger: SubscriptionLedger | null;
  registry: MonitorRegistry | null;
}

function signed(raw: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface Payload {
  meta?: { event_name?: unknown; test_mode?: unknown; custom_data?: { domain?: unknown; locale?: unknown } | null };
  data?: {
    type?: unknown;
    id?: unknown;
    attributes?: {
      status?: unknown;
      variant_id?: unknown;
      customer_id?: unknown;
      ends_at?: unknown;
      updated_at?: unknown;
      test_mode?: unknown;
      user_email?: unknown;
    };
  };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;

function date(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ردٌّ بـ200 على ما لا يعنينا: Lemon Squeezy يعيد إرسال ما لم يُقبل، وحدثٌ
 * لا نستعمله لا ينبغي أن يدور في إعاداتٍ بلا نهاية.
 * وردٌّ بـ503 حين تتعطّل القاعدة: هنا نريد الإعادة.
 */
export async function handleLemonWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (deps.secret === undefined || deps.secret === '') {
    return Response.json({ error: 'billing_disabled' }, { status: 503 });
  }

  const raw = await req.text();
  if (!signed(raw, req.headers.get('x-signature') ?? '', deps.secret)) {
    return Response.json({ error: 'bad_signature' }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const event = str(payload.meta?.event_name);
  if (event === null || !event.startsWith('subscription_') || payload.data?.type !== 'subscriptions') {
    return Response.json({ ignored: event ?? 'unknown' });
  }

  const a = payload.data.attributes ?? {};
  const id = str(payload.data.id);
  const status = str(a.status);
  const updatedAt = date(a.updated_at);
  const domainInput = payload.meta?.custom_data?.domain;
  const domain = typeof domainInput === 'string' ? domainOf(domainInput) : null;

  if (id === null || status === null || updatedAt === null) {
    return Response.json({ ignored: 'malformed' });
  }
  // اشتراكٌ بلا نطاق: دُفع من رابطٍ لم يمرّ بنا. يُقبل الإشعار ولا يُتابَع شيء —
  // والرئيس يراه في لوحة Lemon Squeezy.
  if (domain === null) return Response.json({ ignored: 'no_domain' });

  if (deps.ledger === null || deps.registry === null) {
    return Response.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  try {
    const stored = await deps.ledger.apply({
      id,
      domain,
      status,
      variantId: str(a.variant_id) ?? '',
      customerId: str(a.customer_id) ?? '',
      testMode: a.test_mode === true || payload.meta?.test_mode === true,
      endsAt: date(a.ends_at),
      updatedAt,
      email: typeof a.user_email === 'string' && a.user_email.includes('@') ? a.user_email.trim() : null,
      locale: payload.meta?.custom_data?.locale === 'en' ? 'en' : 'ar',
    });

    // يُحكم بالمحفوظ لا بالوارد: إشعارٌ قديم وصل متأخراً لا يُعيد ما أُغلق.
    const entitled = ENTITLED.has(stored.status);
    if (entitled) {
      await deps.registry.enroll({
        domain: stored.domain,
        url: `https://${stored.domain}/`,
        locale: stored.locale,
        at: updatedAt,
      });
    } else {
      await deps.registry.deactivate(stored.domain);
    }
    return Response.json({ subscription: stored.id, status: stored.status, monitoring: entitled });
  } catch (err) {
    if (err instanceof ArchiveUnavailableError) {
      return Response.json({ error: 'billing_unavailable' }, { status: 503 });
    }
    throw err;
  }
}
