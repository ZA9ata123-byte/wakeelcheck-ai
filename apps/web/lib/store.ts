/**
 * المخزن المشترك ونتائج الفحص — #3.
 *
 * ## لماذا تنتقل النتائج مع الكاش
 *
 * الكاش يحفظ **معرّف** الفحص لا نتيجته. فإن صار الكاش مشتركاً في Redis
 * وبقيت النتائج في ذاكرة النسخة، أعاد الكاشُ لزائرٍ معرّفاً تحفظ نتيجتَه
 * نسخةٌ أخرى — فيرى «جارٍ» حتى تنفد مهلة الواجهة. فالاثنان ينتقلان معاً،
 * أو لا ينتقل أحدهما.
 *
 * ## المفاتيح
 *
 * `scan:<نوع>:<نطاق>` للكاش (في `@wakeelcheck/limits`)، و`result:<معرّف>`
 * للنتائج هنا. بادئتان مختلفتان فلا يطغى أحدهما على الآخر.
 */

import type { ScanResult } from '@wakeelcheck/core';
import { memoryStore, redisStore, type KeyValueStore } from '@wakeelcheck/limits';

export type StoreKind = 'redis' | 'memory';

type Env = (name: string) => string | undefined;

/**
 * أزواج المتغيّرات المقبولة، بالأولوية.
 *
 * الأوّل اسم Upstash نفسه. والثاني ما يضعه تكامل Vercel مع Upstash تلقائياً
 * — فيعمل أيّهما وُجد بلا أن يُطلب من الرئيس نسخُ قيمةٍ من مكانٍ إلى آخر.
 * ولا يُخلط بين زوجين: رابطٌ من واحد ورمزٌ من آخر قاعدتان مختلفتان.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
];

/**
 * Redis إن اكتمل زوجٌ من متغيّراته، والذاكرة غير ذلك.
 *
 * الذاكرة ليست خطأً صامتاً: `/api/health` يُعلن أيّهما يعمل، فيرى الرئيس
 * بعد ضبط المتغيّرات إن كان Redis قد اشتغل فعلاً.
 */
export function storeFromEnv(
  env: Env,
  fetchImpl?: typeof fetch
): { store: KeyValueStore; kind: StoreKind } {
  for (const [urlName, tokenName] of PAIRS) {
    const url = env(urlName);
    const token = env(tokenName);
    if (url !== undefined && url !== '' && token !== undefined && token !== '') {
      const store = redisStore(fetchImpl === undefined ? { url, token } : { url, token, fetch: fetchImpl });
      return { store, kind: 'redis' };
    }
  }
  return { store: memoryStore(), kind: 'memory' };
}

// ── النتائج ──────────────────────────────────────────────────

/**
 * عمر النتيجة في المخزن: يومان.
 *
 * أطول من الكاش (24 ساعة) عمداً — معرّفٌ يعيده الكاش يجب أن تبقى نتيجته
 * حيّة طوال عمره. والسقف يحمي المساحة المجانية في Upstash؛ والحفظ الدائم
 * لروابط التقارير مسألة #5 لا هذه.
 */
export const RESULT_TTL_SECONDS = 48 * 3600;

const resultKey = (id: string): string => `result:${id}`;

export async function saveResult(store: KeyValueStore, result: ScanResult): Promise<void> {
  await store.set(resultKey(result.id), JSON.stringify(result), RESULT_TTL_SECONDS);
}

/** `null` لما لم يُحفظ أو انتهى أو فسد — الواجهة تعيد المحاولة في الحالات كلّها. */
export async function loadResult(store: KeyValueStore, id: string): Promise<ScanResult | null> {
  const raw = await store.get(resultKey(id));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ScanResult;
  } catch {
    return null;
  }
}
