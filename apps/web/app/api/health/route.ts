import { NextResponse } from 'next/server';
import { archive, monitors, storeKind } from '@/lib/scans';
import { verifierFromEnv } from '@/lib/turnstile';

/**
 * ما يحتاج الرئيس أن يراه بعد ضبط المتغيّرات في Vercel:
 *
 * - `demo: false` ← مفتاح النموذج يعمل، والموقع ليس تجريبياً.
 * - `store: "redis"` ← الحدود والكاش والنتائج مشتركة بين النسخ.
 * - `human: true` ← Turnstile مُفعَّل بمفتاحيه معاً.
 * - `archive: true` ← التقارير تبقى دائماً، وروابطها لا تنتهي.
 * - `monitoring: true` ← القاعدة و`CRON_SECRET` معاً: المتابعة الأسبوعية تعمل.
 *
 * لا قيمة متغيّر هنا ولا جزءٌ منها — القاعدة 01. اسم المخزن فقط.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'wakeelcheck',
    demo: process.env['OPENROUTER_API_KEY'] === undefined && process.env['DEEPSEEK_API_KEY'] === undefined,
    store: storeKind,
    human: verifierFromEnv((name) => process.env[name]) !== null,
    archive: archive !== null,
    monitoring: monitors !== null && (process.env['CRON_SECRET'] ?? '') !== '',
  });
}
