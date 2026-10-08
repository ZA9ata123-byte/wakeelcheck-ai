/**
 * أرشيف التقارير — #5.
 *
 * Redis يحفظ التقرير يومين: يكفي ليراه التاجر ويكفي للكاش. لكنّ رابط التقرير
 * يُرسَل إلى شريك ويُفتح بعد أسبوع، والمتابعة الأسبوعية (المرحلة 4) تحتاج
 * فحص الأسبوع الماضي لتقارنه بهذا. هنا يبقى.
 *
 * ## لماذا وثيقةٌ لا جداول
 *
 * مواصفة البناء (`docs/04`) تفصّل التقرير على سبعة جداول. لكنّ كلّ استعمالٍ
 * حقيقيّ اليوم يقرأ التقرير **كاملاً**: رابطٌ يُفتح، أو فحصان يُقارَنان بـ
 * `diffScans`. فجدولٌ واحد بعمود `jsonb`: كتابةٌ واحدة وقراءةٌ واحدة. والتفصيل
 * يعود حين يحتاجه استعلامٌ فعليّ — مخطّطٌ لا يُستعمل مخطّطٌ يُرحَّل بلا داعٍ.
 *
 * والاسم `scan_reports` لا `scans`: لا يتصادم مع جداول المواصفة حين تأتي.
 *
 * ## القاعدة 05
 *
 * `jsonb` يعيد ترتيب المفاتيح ويطرح المسافات بينها، لكنّه يحفظ **قيم النصوص
 * حرفاً بحرف**. فـ`answerText` يخرج كما دخل — ويحرسه اختبار.
 */

import type { ScanKind, ScanResult } from '@wakeelcheck/core';
import type { SqlClient } from './client.ts';

/**
 * يُطبَّق عند أوّل استعمالٍ في كلّ نسخة، وكلّه `IF NOT EXISTS`.
 *
 * فلا أمر ترحيلٍ يُشغَّل يدوياً: الرئيس يضبط الرابط في البيئة، والجدول يُنشأ
 * وحده. وكلّ عبارةٍ في نداءٍ مستقلّ — Neon عبر HTTP لا يقبل عباراتٍ متعدّدة.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS scan_reports (
     id          text        PRIMARY KEY,
     domain      text        NOT NULL,
     kind        text        NOT NULL,
     status      text        NOT NULL,
     result      jsonb       NOT NULL,
     cost_micros bigint      NOT NULL DEFAULT 0,
     created_at  timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS scan_reports_history_idx
     ON scan_reports (domain, kind, created_at DESC)`,
];

/**
 * عطلٌ في الأرشيف — لا أن التقرير غير موجود.
 *
 * الرسالة لا تحمل نصّ الاتصال: فيه كلمة السرّ — القاعدة 01.
 */
export class ArchiveUnavailableError extends Error {
  constructor(detail: string) {
    super(`report archive unavailable: ${detail}`);
    this.name = 'ArchiveUnavailableError';
  }
}

export interface ArchiveEntry {
  /** النطاق كما يُطبَّعه الكاش — بلا `www.` وبحروفٍ صغيرة. */
  domain: string;
  result: ScanResult;
  costMicros: number;
  /** من الساعة المحقونة — فالترتيب حتميٌّ في الاختبار. */
  at: Date;
}

export interface ScanArchive {
  save(entry: ArchiveEntry): Promise<void>;
  get(id: string): Promise<ScanResult | null>;
  /** آخر التقارير المكتملة لمتجرٍ، الأحدث أولاً — ما تقارنه `diffScans`. */
  history(domain: string, kind: ScanKind, limit: number): Promise<ScanResult[]>;
}

const normalize = (domain: string): string => domain.toLowerCase().replace(/^www\./, '');

export function sqlArchive(client: SqlClient): ScanArchive {
  let ready: Promise<void> | null = null;

  // مرّةً لكلّ نسخة. وإن سقطت، يُعاد المحاولة في النداء التالي لا يُحفظ الفشل.
  const ensure = (): Promise<void> => {
    ready ??= (async () => {
      for (const statement of MIGRATIONS) await client.query(statement);
    })().catch((err: unknown) => {
      ready = null;
      throw err;
    });
    return ready;
  };

  const run = async <T>(text: string, params: readonly unknown[]): Promise<T[]> => {
    try {
      await ensure();
      return await client.query<T>(text, params);
    } catch (err) {
      throw new ArchiveUnavailableError(err instanceof Error ? err.name : 'query failed');
    }
  };

  return {
    async save({ domain, result, costMicros, at }) {
      // يُعاد الحفظ بلا ضرر: التقرير نفسه يُحدَّث، وتاريخ إنشائه يبقى.
      await run(
        `INSERT INTO scan_reports (id, domain, kind, status, result, cost_micros, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (id) DO UPDATE
           SET status = EXCLUDED.status,
               result = EXCLUDED.result,
               cost_micros = EXCLUDED.cost_micros`,
        [
          result.id,
          normalize(domain),
          result.kind,
          result.status,
          JSON.stringify(result),
          Math.round(costMicros),
          at.toISOString(),
        ]
      );
    },

    async get(id) {
      const rows = await run<{ result: ScanResult }>(
        'SELECT result FROM scan_reports WHERE id = $1',
        [id]
      );
      return rows[0]?.result ?? null;
    },

    async history(domain, kind, limit) {
      const rows = await run<{ result: ScanResult }>(
        `SELECT result FROM scan_reports
         WHERE domain = $1 AND kind = $2 AND status = 'done'
         ORDER BY created_at DESC
         LIMIT $3`,
        [normalize(domain), kind, Math.max(0, Math.trunc(limit))]
      );
      return rows.map((r) => r.result);
    },
  };
}
