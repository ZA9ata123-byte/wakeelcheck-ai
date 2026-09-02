/**
 * فحص القواعد نفسها عبر دفعة متاجر.
 *
 * قاعدةٌ نجحت على كلّ متجر لم تفرّق بين متجرين، فهي تُضخّم النتيجة بلا أن
 * تقيس شيئاً. وقاعدةٌ رسبت على كلّ متجر إمّا مكسورة وإمّا مقيَّمة في الموضع
 * الخطأ — وهذا بالضبط ما حدث حين كانت قواعد المنتج تُقيَّم على الصفحة
 * الرئيسية فتُرسب كلّ متجر.
 *
 * الاختباران في `packages/readiness/test` يحرسان القاعدة الواحدة في سياقين.
 * هذا يحرسها على متاجر حقيقية، حيث السياقات عشرون لا اثنان.
 */

import type { RuleResult } from '@wakeelcheck/core';

/** لماذا تستحق القاعدة نظرة. */
export type RuleFlag = 'never_failed' | 'never_passed' | 'ok';

export interface RuleAudit {
  key: string;
  weight: number;
  passed: number;
  total: number;
  flag: RuleFlag;
  /** أمثلة على نطاقات أخفقت فيها — للقراءة لا للإحصاء. */
  failedAt: readonly string[];
}

export interface BatchAudit {
  stores: number;
  rules: readonly RuleAudit[];
  /** ما يستحق النظر أولاً، مرتّباً بالوزن — الأثقل أخطر. */
  suspicious: readonly RuleAudit[];
}

/**
 * يجمع نتائج القواعد عبر متاجر عدّة ويُبرز ما يستحق النظر.
 *
 * العتبة ليست نسبة بل حدّ: نجاحٌ تامّ أو إخفاقٌ تامّ. ما بينهما يعني أنّ
 * القاعدة فرّقت بين متجرٍ وآخر، وهذا كلّ المطلوب منها.
 *
 * ودفعةٌ من متجرٍ واحد لا تُنتج حكماً — كلّ قاعدة فيها إمّا نجحت تماماً
 * وإمّا أخفقت تماماً. لذلك تُعاد `suspicious` فارغةً تحت متجرين.
 */
export function auditRules(
  perStore: readonly { domain: string; rules: readonly RuleResult[] }[]
): BatchAudit {
  const acc = new Map<string, { weight: number; passed: number; total: number; failedAt: string[] }>();

  for (const store of perStore) {
    for (const rule of store.rules) {
      const entry = acc.get(rule.key) ?? { weight: rule.weight, passed: 0, total: 0, failedAt: [] };
      entry.total += 1;
      if (rule.passed) entry.passed += 1;
      else entry.failedAt.push(store.domain);
      acc.set(rule.key, entry);
    }
  }

  const rules: RuleAudit[] = [...acc.entries()]
    .map(([key, e]) => ({
      key,
      weight: e.weight,
      passed: e.passed,
      total: e.total,
      flag:
        e.total === 0
          ? ('ok' as RuleFlag)
          : e.passed === e.total
            ? ('never_failed' as RuleFlag)
            : e.passed === 0
              ? ('never_passed' as RuleFlag)
              : ('ok' as RuleFlag),
      failedAt: e.failedAt.slice(0, 5),
    }))
    .sort((a, b) => b.weight - a.weight);

  // متجرٌ واحد لا يكفي لحكم: كلّ قاعدة فيه طرفٌ من الطرفين.
  const suspicious = perStore.length < 2 ? [] : rules.filter((r) => r.flag !== 'ok');

  return { stores: perStore.length, rules, suspicious };
}
