/**
 * ما تغيّر بين فحصين — نواة المنتج المدفوع.
 *
 * الفحص الواحد لقطة. والذي يُشترى شهرياً هو الجملة: «اختفيتَ من AI Overviews
 * هذا الأسبوع، وظهر بيت الأناقة مكانك».
 *
 * دالّة خالصة: لا تخزين ولا ساعة. التخزين (#5) مسألةُ **حفظ** اللقطتين، لا
 * مسألةُ مقارنتهما — فالمقارنة تُبنى وتُختبر اليوم.
 *
 * ## الخطر الذي يُبطل المنتج كلّه
 *
 * تنبيهٌ كاذب واحد يُفقد التاجر ثقته في كل تنبيه بعده. ومصدر الكذب هنا
 * واحد: **محرّك لم يُقَس**. إن سقط Perplexity هذا الأسبوع فقلنا «اختفيتَ من
 * Perplexity»، فقد نسبنا عطلاً عندنا إلى موقعه.
 *
 * لهذا يُحسب كل شيء على **المحرّكات المقيسة في الفحصين معاً** وحدها. وما
 * سقط في أحدهما يُعرَض بحالته `null` ولا يدخل حكماً — القاعدة 06 ممتدّةً
 * إلى الزمن.
 */

import type {
  Bilingual,
  Engine,
  EngineCoverage,
  MatrixRow,
  RuleResult,
  ScanResult,
} from '@wakeelcheck/core';
import { buildMatrix, normalizeArabic } from '@wakeelcheck/visibility';

export type ChangeDirection = 'gained' | 'lost' | 'unchanged';

export interface EngineChange {
  engine: Engine;
  before: EngineCoverage;
  after: EngineCoverage;
  /** `null` حين لم يُقَس أحد الطرفين — لا حكم بلا قياسين. */
  direction: ChangeDirection | null;
}

export interface CompetitorChange {
  name: string;
  change: 'appeared' | 'disappeared';
  /** عدد المحرّكات المقيسة في الفحصين التي ذكرته — قبل وبعد. */
  before: number;
  after: number;
}

export interface RuleChange {
  ruleKey: string;
  weight: number;
  change: 'fixed' | 'regressed';
  detail: Bilingual;
}

export interface ScanDiff {
  /** كل محرّك وحاله في الفحصين، ومن سقط منهما يُعرَض ولا يُحكَم عليه. */
  engines: readonly EngineChange[];
  /** المحرّكات التي قِيست في الفحصين معاً — مقام كل ما تحته. */
  comparableEngines: readonly Engine[];
  competitors: readonly CompetitorChange[];
  rules: readonly RuleChange[];
  scoreBefore: number;
  scoreAfter: number;
  /** هل تغيّر شيءٌ نملك إثباته؟ */
  changed: boolean;
}

function weightedScore(rules: readonly RuleResult[]): number {
  const sum = rules.reduce((a, r) => a + r.weight, 0);
  const got = rules.reduce((a, r) => a + (r.passed ? r.weight : 0), 0);
  return sum === 0 ? 0 : Math.round((got / sum) * 100);
}

/** حضور كل منافس، محسوباً على الأعمدة المقيسة في الفحصين وحدها. */
function presenceOn(matrix: readonly MatrixRow[], engines: ReadonlySet<Engine>): Map<string, { name: string; count: number }> {
  const out = new Map<string, { name: string; count: number }>();

  for (const row of matrix) {
    if (row.isStore) continue;
    const key = normalizeArabic(row.name);
    const count = row.cells.filter((c) => engines.has(c.engine) && c.state === 'mentioned').length;
    // الهوية مطبَّعة: «بيت الأناقة» و«بيت الاناقه» صفٌّ واحد، وإلّا قُرئ
    // اختلافُ تهجئة تغيّراً أسبوعياً.
    const seen = out.get(key);
    if (seen === undefined) out.set(key, { name: row.name, count });
    else seen.count = Math.max(seen.count, count);
  }

  return out;
}

/**
 * يقابل فحصاً بفحصٍ سابق له على نفس المتجر.
 *
 * ترتيب الوسيطين هو ترتيب الزمن: `before` أقدم.
 */
export function diffScans(before: ScanResult, after: ScanResult): ScanDiff {
  const beforeRows = before.shareOfVoice.byEngine;
  const afterRows = after.shareOfVoice.byEngine;

  const beforeBy = new Map(beforeRows.map((r) => [r.engine, r]));
  const afterBy = new Map(afterRows.map((r) => [r.engine, r]));

  // اتّحاد المحرّكات حتى يظهر محرّكٌ أُضيف أو سقط، لا تقاطعُها.
  const allEngines: Engine[] = [
    ...beforeRows.map((r) => r.engine),
    ...afterRows.filter((r) => !beforeBy.has(r.engine)).map((r) => r.engine),
  ];

  const engines: EngineChange[] = allEngines.map((engine) => {
    const b = beforeBy.get(engine)?.coverage ?? 'not_measured';
    const a = afterBy.get(engine)?.coverage ?? 'not_measured';

    // القياس شرط الحكم. غيابه يُعرَض ولا يُفسَّر.
    if (b === 'not_measured' || a === 'not_measured') {
      return { engine, before: b, after: a, direction: null };
    }
    return {
      engine,
      before: b,
      after: a,
      direction: b === a ? 'unchanged' : a === 'mentioned' ? 'gained' : 'lost',
    };
  });

  const comparable = new Set<Engine>(
    engines.filter((e) => e.direction !== null).map((e) => e.engine)
  );

  // المنافسون: يُحسبون على الأعمدة المقيسة في الفحصين وحدها، وإلّا بدا
  // سقوطُ عمودٍ اختفاءَ منافس.
  const beforeSeen = presenceOn(buildMatrix(beforeRows, '—'), comparable);
  const afterSeen = presenceOn(buildMatrix(afterRows, '—'), comparable);

  const competitors: CompetitorChange[] = [];

  for (const [key, now] of afterSeen) {
    const was = beforeSeen.get(key)?.count ?? 0;
    if (was === 0 && now.count > 0) {
      competitors.push({ name: now.name, change: 'appeared', before: 0, after: now.count });
    }
  }
  for (const [key, was] of beforeSeen) {
    const now = afterSeen.get(key)?.count ?? 0;
    if (was.count > 0 && now === 0) {
      competitors.push({ name: was.name, change: 'disappeared', before: was.count, after: 0 });
    }
  }

  // القواعد: لا تُقارَن إلّا ما قُيّم في الفحصين. قاعدةٌ أُضيفت إلى السجلّ
  // بين الفحصين ليست انتكاسةً ولا إصلاحاً — لم تكن تُقاس أصلاً.
  //
  // ولا تُستعمل `compareRules` هنا رغم تطابق العملية: هي تأخذ `detail` من
  // الطرف **الناجح**، وهو الصحيح في مقارنة منافس. أمّا في الزمن فالتاجر
  // يتصرّف على **الحال الآن**؛ فانتكاسةٌ تُعرَض بنصّ الأسبوع الماضي تقول
  // «خريطة الموقع متاحة» وهي التي عطبت للتوّ.
  const past = new Map(before.rules.map((r) => [r.key, r]));

  const rules: RuleChange[] = [];
  for (const now of after.rules) {
    const then = past.get(now.key);
    if (then === undefined || then.passed === now.passed) continue;

    rules.push({
      ruleKey: now.key,
      weight: now.weight,
      change: now.passed ? 'fixed' : 'regressed',
      detail: now.detail, // الحال الآن — هو ما يُتصرَّف عليه
    });
  }

  // الانتكاسات أولاً، والأثقل وزناً قبل الأخفّ: ما يحتاج تدخّلاً يُقرأ أولاً.
  rules.sort(
    (a, b) =>
      Number(a.change === 'fixed') - Number(b.change === 'fixed') || b.weight - a.weight
  );

  return {
    engines,
    comparableEngines: [...comparable],
    competitors: competitors.sort((a, b) => b.after - a.after || a.name.localeCompare(b.name, 'ar')),
    rules,
    scoreBefore: weightedScore(before.rules),
    scoreAfter: weightedScore(after.rules),
    changed:
      engines.some((e) => e.direction === 'gained' || e.direction === 'lost') ||
      competitors.length > 0 ||
      rules.length > 0,
  };
}
