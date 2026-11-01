/**
 * «لماذا حدث» — من قواعد هذا المتجر، لا مثالاً ثابتاً.
 *
 * كانت البطاقة تقول «GPTBot → blocked» لكلّ متجر، ومعها إصلاح robots.txt —
 * ولو كان GPTBot مسموحاً. ادّعاءٌ بلا قياس أمام تاجرٍ يقرأ تقريره (القاعدة 06).
 *
 * السبب الأثقل وزناً بين ما أخفق؛ وعند التعادل ما له إصلاحٌ جاهز.
 */

import type { RuleResult } from '@wakeelcheck/core';

export function pickCause(rules: readonly RuleResult[]): RuleResult | null {
  const failed = rules.filter((r) => !r.passed);
  if (failed.length === 0) return null;
  const hasFix = (r: RuleResult): number => (r.fixSnippet !== undefined && r.fixSnippet !== '' ? 1 : 0);
  return [...failed].sort((a, b) => b.weight - a.weight || hasFix(b) - hasFix(a))[0] ?? null;
}
