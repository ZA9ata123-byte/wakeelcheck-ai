/**
 * الحدود الثلاثة التي تقف بين الفحص المجاني وبين فاتورة لا تُحتمل.
 *
 * القاعدة الملزمة رقم 04. بلا هذه الطبقة، حملة مؤثر واحدة ناجحة تُنتج
 * عشرين ألف فحص مجاني في شهر — أي آلاف الريالات بلا إيراد مضمون.
 *
 * ثلاث طبقات، الأرخص أولاً:
 *   1. الكاش   — نفس النطاق خلال 24 ساعة يُعاد بلا تكلفة إطلاقاً.
 *   2. حدّ IP  — عدد الفحوصات المجانية لكل زائر في اليوم.
 *   3. الميزانية — سقف إنفاق شهري يوقف كل شيء عند بلوغه.
 */

import { createHash } from 'node:crypto';
import type { ScanKind } from '@wakeelcheck/core';
import type { KeyValueStore } from './store.ts';

const DAY = 86_400;

/**
 * يجزّئ عنوان الزائر قبل تخزينه.
 *
 * عنوان IP بيانات شخصية. تخزينه خاماً لعدّ الفحوصات لا مبرّر له، ويجعل
 * أي تسريب أسوأ بلا مقابل — التجزئة تكفي تماماً للعدّ.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

// ── 1. الكاش ─────────────────────────────────────────────────

export interface CacheOptions {
  ttlHours: number;
}

function cacheKey(domain: string, kind: ScanKind): string {
  return `scan:${kind}:${domain.toLowerCase().replace(/^www\./, '')}`;
}

/**
 * يبحث عن فحص حديث لنفس النطاق.
 *
 * أثره الأكبر في حملات المؤثرين تحديداً: المتابعون يفحصون المتاجر المشهورة
 * نفسها، فيتحوّل مئات الطلبات إلى فحص واحد مدفوع الثمن.
 */
export async function getCachedScan(
  store: KeyValueStore,
  domain: string,
  kind: ScanKind
): Promise<string | null> {
  return store.get(cacheKey(domain, kind));
}

export async function setCachedScan(
  store: KeyValueStore,
  domain: string,
  kind: ScanKind,
  scanId: string,
  opts: CacheOptions
): Promise<void> {
  await store.set(cacheKey(domain, kind), scanId, opts.ttlHours * 3600);
}

// ── 2. حدّ الزائر ────────────────────────────────────────────

export interface RateDecision {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * يستهلك محاولة واحدة من رصيد الزائر اليومي.
 *
 * يزيد العدّاد أولاً ثم يقرّر: القراءة قبل الزيادة تفتح سباقاً يسمح لطلبات
 * متزامنة بتجاوز الحدّ معاً.
 */
export async function consumeIpQuota(
  store: KeyValueStore,
  ipHash: string,
  limit: number
): Promise<RateDecision> {
  if (limit <= 0) {
    return { allowed: false, used: 0, limit, remaining: 0 };
  }

  const used = await store.incrBy(`rate:${ipHash}`, 1, DAY);

  return {
    allowed: used <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/** يقرأ الرصيد بلا استهلاك — للعرض فقط. */
export async function peekIpQuota(
  store: KeyValueStore,
  ipHash: string,
  limit: number
): Promise<RateDecision> {
  const used = Number((await store.get(`rate:${ipHash}`)) ?? 0);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

// ── 3. الميزانية ─────────────────────────────────────────────

export interface BudgetState {
  spentMicros: number;
  capMicros: number;
  withinBudget: boolean;
  /** نسبة الاستهلاك 0–1، للتنبيه قبل بلوغ السقف. */
  ratio: number;
}

function monthKey(now: Date): string {
  return `budget:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** انتهاء صلاحية يتجاوز أطول شهر، فالمفتاح يتغيّر بتغيّر الشهر على أي حال. */
const MONTH_TTL = 32 * DAY;

export async function recordSpend(
  store: KeyValueStore,
  micros: number,
  now: Date
): Promise<number> {
  if (micros <= 0) return Number((await store.get(monthKey(now))) ?? 0);
  return store.incrBy(monthKey(now), Math.round(micros), MONTH_TTL);
}

export async function checkBudget(
  store: KeyValueStore,
  maxMonthlyUsd: number,
  now: Date
): Promise<BudgetState> {
  const spentMicros = Number((await store.get(monthKey(now))) ?? 0);
  const capMicros = maxMonthlyUsd * 1_000_000;

  return {
    spentMicros,
    capMicros,
    withinBudget: spentMicros < capMicros,
    ratio: capMicros === 0 ? 1 : spentMicros / capMicros,
  };
}

// ── القرار المجمَّع ──────────────────────────────────────────

export type AdmissionReason = 'ok' | 'cached' | 'rate_limited' | 'budget_exceeded';

export interface Admission {
  reason: AdmissionReason;
  /** موجود حين يكون السبب `cached`. */
  scanId?: string;
  rate?: RateDecision;
}

export interface AdmissionInput {
  domain: string;
  kind: ScanKind;
  ipHash: string;
  perIpPerDay: number;
  maxMonthlyUsd: number;
  cacheTtlHours: number;
  now: Date;
}

/**
 * يقرّر قبول فحص جديد أو ردّه.
 *
 * الترتيب مقصود: الكاش أولاً لأنه لا يكلّف شيئاً ولا يستهلك رصيد الزائر —
 * من يفحص متجراً فحصه غيره قبل دقيقة لا ينبغي أن يُعاقَب على ذلك.
 */
export async function admit(store: KeyValueStore, input: AdmissionInput): Promise<Admission> {
  const cached = await getCachedScan(store, input.domain, input.kind);
  if (cached !== null) {
    return { reason: 'cached', scanId: cached };
  }

  const budget = await checkBudget(store, input.maxMonthlyUsd, input.now);
  if (!budget.withinBudget) {
    return { reason: 'budget_exceeded' };
  }

  const rate = await consumeIpQuota(store, input.ipHash, input.perIpPerDay);
  if (!rate.allowed) {
    return { reason: 'rate_limited', rate };
  }

  return { reason: 'ok', rate };
}
