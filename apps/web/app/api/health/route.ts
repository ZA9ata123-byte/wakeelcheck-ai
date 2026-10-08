import { NextResponse } from 'next/server';
import { storeKind } from '@/lib/scans';

/**
 * ما يحتاج الرئيس أن يراه بعد ضبط المتغيّرات في Vercel:
 *
 * - `demo: false` ← مفتاح النموذج يعمل، والموقع ليس تجريبياً.
 * - `store: "redis"` ← الحدود والكاش والنتائج مشتركة بين النسخ.
 *
 * لا قيمة متغيّر هنا ولا جزءٌ منها — القاعدة 01. اسم المخزن فقط.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'wakeelcheck',
    demo: process.env['OPENROUTER_API_KEY'] === undefined && process.env['DEEPSEEK_API_KEY'] === undefined,
    store: storeKind,
  });
}
