/**
 * تشغيل القواعد وحساب النتيجة.
 *
 * الإصلاح الثالث: النتيجة موزونة — `Σ(weight × passed) / Σweight`.
 * المحرّك القديم كان يحسب `عدد الناجحة / 64`، فتساوت قاعدة وزنها 10 مع
 * قاعدة وزنها 3، وبقيت الأوزان المحسوبة كوداً ميتاً لا يؤثر في شيء.
 */

import type { RuleResult } from '@wakeelcheck/core';
import type { Rule, ScanContext } from './context.ts';
import { ACTIVE_RULES } from './rules/index.ts';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReadinessReport {
  /** 0–100، موزونة. */
  score: number;
  grade: Grade;
  results: RuleResult[];
  /** الإخفاقات مرتّبة بالأثقل وزناً أولاً — ترتيب الإصلاح. */
  failures: RuleResult[];
  weightPassed: number;
  weightTotal: number;
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export function runReadiness(
  ctx: ScanContext,
  rules: readonly Rule[] = ACTIVE_RULES
): ReadinessReport {
  const results: RuleResult[] = [];
  let weightPassed = 0;
  let weightTotal = 0;

  for (const rule of rules) {
    if (!rule.active) continue;

    // قاعدة معطوبة يجب ألّا تُسقط الفحص كله.
    let outcome: Omit<RuleResult, 'key' | 'weight'>;
    try {
      outcome = rule.evaluate(ctx);
    } catch (err) {
      outcome = {
        passed: false,
        detail: {
          ar: 'تعذّر تقييم هذه القاعدة',
          en: 'Rule evaluation failed',
        },
        evidence: err instanceof Error ? err.message : 'unknown error',
      };
    }

    weightTotal += rule.weight;
    if (outcome.passed) weightPassed += rule.weight;

    results.push({ key: rule.key, weight: rule.weight, ...outcome });
  }

  const score = weightTotal === 0 ? 0 : Math.round((weightPassed / weightTotal) * 100);

  return {
    score,
    grade: gradeFor(score),
    results,
    failures: results.filter((r) => !r.passed).sort((a, b) => b.weight - a.weight),
    weightPassed,
    weightTotal,
  };
}
