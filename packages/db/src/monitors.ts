/**
 * سجلّ المتابعة — المرحلة 4.
 *
 * من يُتابَع، وبأيّ أسئلة، ومتى فُحص آخر مرّة، وما قيل له.
 *
 * ## الأسئلة تُحفظ هنا ولا تُعاد صياغتها
 *
 * إجابتا أسبوعين على سؤالين مختلفين لا تُقارَنان. فأسئلة المتجر تُكتب مرّةً
 * — عند أوّل قياس — ثم تُقرأ كلّ أسبوع كما هي. ولا تُكتب فوقها: `setQuestions`
 * لا تُغيّر أسئلةً موجودة.
 *
 * ## لا بيانات تواصل بعد
 *
 * لمن تُرسَل النشرة (بريد؟ واتساب؟) قرارٌ لم يُتّخذ. فلا يُحفظ هنا بريدٌ ولا
 * رقم حتى يُتّخذ: بياناتٌ شخصية بلا استعمال عبءٌ بلا فائدة.
 */

import type { BuyingQuestion, Digest } from '@wakeelcheck/core';
import type { SqlClient } from './client.ts';
import { schemaRunner } from './archive.ts';

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS monitors (
     domain      text        PRIMARY KEY,
     url         text        NOT NULL,
     locale      text        NOT NULL DEFAULT 'ar',
     questions   jsonb,
     active      boolean     NOT NULL DEFAULT true,
     created_at  timestamptz NOT NULL,
     last_run_at timestamptz,
     last_report text
   )`,
  `CREATE INDEX IF NOT EXISTS monitors_due_idx ON monitors (active, last_run_at)`,
  `CREATE TABLE IF NOT EXISTS monitor_digests (
     report_id  text        PRIMARY KEY,
     domain     text        NOT NULL,
     digest     jsonb       NOT NULL,
     created_at timestamptz NOT NULL
   )`,
];

export interface Monitor {
  domain: string;
  url: string;
  locale: string;
  /** `null` حتى أوّل قياس — ثم ثابتة. */
  questions: BuyingQuestion[] | null;
  active: boolean;
  createdAt: Date;
  lastRunAt: Date | null;
  lastReport: string | null;
}

export interface MonitorRegistry {
  /** يسجّل متجراً للمتابعة، أو يعيد تفعيله — ولا يمسّ أسئلته إن وُجدت. */
  enroll(input: { domain: string; url: string; locale: string; at: Date }): Promise<void>;
  deactivate(domain: string): Promise<void>;
  get(domain: string): Promise<Monitor | null>;
  /** المستحقّة: لم تُفحص قطّ، أو مضت عليها المدّة. الأقدم أولاً. */
  due(now: Date, intervalDays: number, limit: number): Promise<Monitor[]>;
  /** يكتب الأسئلة إن لم تكن — ولا يكتب فوقها. يُرجع ما صار محفوظاً. */
  setQuestions(domain: string, questions: readonly BuyingQuestion[]): Promise<BuyingQuestion[]>;
  markRun(domain: string, at: Date, reportId: string): Promise<void>;
  saveDigest(input: { reportId: string; domain: string; digest: Digest; at: Date }): Promise<void>;
  digestFor(reportId: string): Promise<Digest | null>;
}

const normalize = (domain: string): string => domain.toLowerCase().replace(/^www\./, '');

interface Row {
  domain: string;
  url: string;
  locale: string;
  questions: BuyingQuestion[] | null;
  active: boolean;
  created_at: Date | string;
  last_run_at: Date | string | null;
  last_report: string | null;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function fromRow(row: Row): Monitor {
  return {
    domain: row.domain,
    url: row.url,
    locale: row.locale,
    questions: row.questions,
    active: row.active,
    createdAt: asDate(row.created_at),
    lastRunAt: row.last_run_at === null ? null : asDate(row.last_run_at),
    lastReport: row.last_report,
  };
}

const COLUMNS = 'domain, url, locale, questions, active, created_at, last_run_at, last_report';

export function sqlMonitors(client: SqlClient): MonitorRegistry {
  const run = schemaRunner(client, MIGRATIONS);

  return {
    async enroll({ domain, url, locale, at }) {
      await run(
        `INSERT INTO monitors (domain, url, locale, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (domain) DO UPDATE
           SET active = true, url = EXCLUDED.url, locale = EXCLUDED.locale`,
        [normalize(domain), url, locale, at.toISOString()]
      );
    },

    async deactivate(domain) {
      await run('UPDATE monitors SET active = false WHERE domain = $1', [normalize(domain)]);
    },

    async get(domain) {
      const rows = await run<Row>(`SELECT ${COLUMNS} FROM monitors WHERE domain = $1`, [
        normalize(domain),
      ]);
      return rows[0] === undefined ? null : fromRow(rows[0]);
    },

    async due(now, intervalDays, limit) {
      const cutoff = new Date(now.getTime() - intervalDays * 86_400_000).toISOString();
      const rows = await run<Row>(
        `SELECT ${COLUMNS} FROM monitors
         WHERE active AND (last_run_at IS NULL OR last_run_at <= $1)
         ORDER BY last_run_at ASC NULLS FIRST, created_at ASC
         LIMIT $2`,
        [cutoff, Math.max(0, Math.trunc(limit))]
      );
      return rows.map(fromRow);
    },

    async setQuestions(domain, questions) {
      // `COALESCE` على العمود القائم: الموجود يبقى، والفارغ وحده يُكتب.
      const rows = await run<{ questions: BuyingQuestion[] }>(
        `UPDATE monitors SET questions = COALESCE(questions, $2::jsonb)
         WHERE domain = $1
         RETURNING questions`,
        [normalize(domain), JSON.stringify(questions)]
      );
      return rows[0]?.questions ?? [];
    },

    async markRun(domain, at, reportId) {
      await run('UPDATE monitors SET last_run_at = $2, last_report = $3 WHERE domain = $1', [
        normalize(domain),
        at.toISOString(),
        reportId,
      ]);
    },

    async saveDigest({ reportId, domain, digest, at }) {
      await run(
        `INSERT INTO monitor_digests (report_id, domain, digest, created_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (report_id) DO UPDATE SET digest = EXCLUDED.digest`,
        [reportId, normalize(domain), JSON.stringify(digest), at.toISOString()]
      );
    },

    async digestFor(reportId) {
      const rows = await run<{ digest: Digest }>(
        'SELECT digest FROM monitor_digests WHERE report_id = $1',
        [reportId]
      );
      return rows[0]?.digest ?? null;
    },
  };
}
