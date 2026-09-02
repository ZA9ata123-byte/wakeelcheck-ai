/**
 * مقارنة متجرٍ بمنافس على نفس القواعد.
 *
 * ما نُخرجه **اختلافٌ مرصود** لا سبب. أن يضبط منافسٌ `schema.product` وأن
 * يظهر في سبعة محرّكات واقعتان رأيناهما؛ وأنّ الأولى صنعت الثانية ادّعاءٌ
 * لم نقسه ولا نملك قياسه. القاعدة 06 على السببية كما هي على الأرقام —
 * وهو التحفّظ الذي رفعه codex في CODEX-004 وقبِلتُه.
 *
 * ولا نقارن إلّا ما قِيس عند الطرفين. قاعدةٌ قُيّمت عند أحدهما فقط ليست
 * فجوةً بل ثقب قياس، وعدُّها فجوةً يخترع تفوّقاً لم يحدث.
 */

import type { ObservedDifference, RuleResult } from '@wakeelcheck/core';

export interface RuleComparison {
  /** ضبطها المنافس وأخفق فيها المتجر — الأثقل وزناً أولاً. */
  ahead: readonly ObservedDifference[];
  /** ضبطها المتجر وأخفق فيها المنافس — تُوازن الصورة. */
  behind: readonly ObservedDifference[];
  /** كم قاعدة قِيست عند الطرفين معاً — مقام أي نسبة تُبنى على هذا. */
  compared: number;
}

const byWeight = (a: ObservedDifference, b: ObservedDifference): number => b.weight - a.weight;

/**
 * يقابل نتيجتَي جاهزية على المفتاح.
 *
 * `evidence` و`detail` يُؤخذان من الطرف **الناجح** دائماً: هو وحده عنده
 * ما يُرى. أمّا `weight` فمن المتجر، لأن الميزان الذي تُقرأ عليه النتيجة
 * ميزانه هو.
 */
export function compareRules(
  store: readonly RuleResult[],
  rival: readonly RuleResult[]
): RuleComparison {
  const mine = new Map(store.map((r) => [r.key, r]));

  const ahead: ObservedDifference[] = [];
  const behind: ObservedDifference[] = [];
  let compared = 0;

  for (const theirs of rival) {
    const ours = mine.get(theirs.key);
    if (ours === undefined) continue; // لم يُقَس عندنا — ليس فجوة
    compared += 1;

    if (theirs.passed && !ours.passed) {
      ahead.push({
        ruleKey: theirs.key,
        weight: ours.weight,
        detail: theirs.detail,
        evidence: theirs.evidence,
      });
    } else if (ours.passed && !theirs.passed) {
      behind.push({
        ruleKey: ours.key,
        weight: ours.weight,
        detail: ours.detail,
        evidence: ours.evidence,
      });
    }
  }

  return { ahead: ahead.sort(byWeight), behind: behind.sort(byWeight), compared };
}
