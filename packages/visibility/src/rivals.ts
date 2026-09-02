/**
 * من نفحص من المنافسين — الاختيار وحده، بلا شبكة.
 *
 * المصفوفة تُخرج كل من ذُكر. وفحص جاهزية كلٍّ منهم يعني `fetch` لكل نطاق،
 * وهو ما يضاعف زمن الفحص — التحفّظ الذي رفعه codex في CODEX-004. فالسقف
 * ليس تفصيلاً في الإعدادات بل جزءٌ من العقد: نفحص الأعلى حضوراً ونصرّح بمن
 * لم نفحصه ولماذا.
 *
 * ولأنّ من سقط يُذكر ولا يُحذف، تبقى المعادلة قائمة دائماً:
 * `picked.length + skipped.length === عدد المنافسين`. الاختبار يحرسها.
 */

import type { MatrixRow, RivalSkipped } from '@wakeelcheck/core';

/** منافسٌ اختير للفحص — له نطاق، وهو ضمن السقف. */
export interface RivalPick {
  name: string;
  domain: string;
  present: number;
  measured: number;
}

export interface RivalSelection {
  picked: readonly RivalPick[];
  skipped: readonly RivalSkipped[];
  /** السقف المطبَّق فعلاً بعد الحدّ الأدنى. */
  cap: number;
}

/** الافتراضي: ثلاثة. أبعد من ذلك يضاعف الزمن بلا أن يضيف حكماً. */
export const DEFAULT_RIVAL_CAP = 3;

/**
 * يرتّب المنافسين بالحضور ويأخذ منهم ما يسع السقف.
 *
 * الترتيب بعدد المحرّكات التي ذكرته — هو تعريف «يسبقك» الوحيد الذي نملك
 * قياسه. وعند التساوي نرتّب بالاسم: ترتيبٌ ثابت يمكن اختباره، لا ترتيبُ
 * ورودٍ يتغيّر بتغيّر إجابة.
 *
 * صاحب الاسم بلا نطاق يُصرَّح به `no_domain` ولا يستهلك مقعداً: لا شيء
 * نفحصه عنده، وحجبُه عن القائمة يجعل أقوى منافسٍ يختفي بلا أثر.
 */
export function selectRivals(
  matrix: readonly MatrixRow[],
  cap: number = DEFAULT_RIVAL_CAP
): RivalSelection {
  const limit = Math.max(0, Math.trunc(cap));

  const rivals = matrix
    .filter((row) => !row.isStore && row.present > 0)
    .slice()
    .sort((a, b) => (b.present - a.present) || a.name.localeCompare(b.name, 'ar'));

  const picked: RivalPick[] = [];
  const skipped: RivalSkipped[] = [];

  for (const row of rivals) {
    if (row.domain === null || row.domain === '') {
      skipped.push({ name: row.name, domain: null, reason: 'no_domain' });
      continue;
    }
    if (picked.length >= limit) {
      skipped.push({ name: row.name, domain: row.domain, reason: 'over_cap' });
      continue;
    }
    picked.push({
      name: row.name,
      domain: row.domain,
      present: row.present,
      measured: row.measured,
    });
  }

  return { picked, skipped, cap: limit };
}
