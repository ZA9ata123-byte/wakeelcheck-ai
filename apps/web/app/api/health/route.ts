import { NextResponse } from 'next/server';
import { archive, mailer, monitors, storeKind, subscriptions } from '@/lib/scans';
import { checkoutTarget } from '@/lib/billing';
import { verifierFromEnv } from '@/lib/turnstile';
import { isDemo, llmKeys } from '@/lib/llm-env';

/**
 * ما يحتاج الرئيس أن يراه بعد ضبط المتغيّرات في Vercel:
 *
 * - `demo: false` ← مفتاح النموذج يعمل، والموقع ليس تجريبياً.
 * - `store: "redis"` ← الحدود والكاش والنتائج مشتركة بين النسخ.
 * - `human: true` ← Turnstile مُفعَّل بمفتاحيه معاً.
 * - `archive: true` ← التقارير تبقى دائماً، وروابطها لا تنتهي.
 * - `monitoring: true` ← القاعدة و`CRON_SECRET` معاً: المتابعة الأسبوعية تعمل.
 * - `billing: true` ← رابط الدفع وسرّ الإشعار والقاعدة معاً: الاشتراك يفتح المتابعة.
 * - `mail: true` ← مفتاح Resend وعنوان المرسِل: النشرة الأسبوعية تُرسل.
 *
 * لا قيمة متغيّر هنا ولا جزءٌ منها — القاعدة 01. اسم المخزن فقط.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'wakeelcheck',
    demo: isDemo(llmKeys((name) => process.env[name])),
    store: storeKind,
    human: verifierFromEnv((name) => process.env[name]) !== null,
    archive: archive !== null,
    monitoring: monitors !== null && (process.env['CRON_SECRET'] ?? '') !== '',
    billing:
      subscriptions !== null &&
      (process.env['LEMONSQUEEZY_WEBHOOK_SECRET'] ?? '') !== '' &&
      checkoutTarget(process.env['LEMONSQUEEZY_CHECKOUT_URL'], 'example.com', 'ar') !== null,
    mail: mailer !== null,
  });
}
