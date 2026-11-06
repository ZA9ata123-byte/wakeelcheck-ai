/**
 * الاشتراكات — ما قاله Lemon Squeezy آخرَ مرّة عن كلّ اشتراك.
 *
 * ## الأحدث يغلب، لا الأخير وصولاً
 *
 * الإشعارات تصل بلا ترتيب مضمون، وتُعاد عند أيّ فشل. فلا يُكتب حدثٌ فوق
 * ما هو أحدث منه: `updated_at` من Lemon Squeezy هو الحَكَم. وبهذا يصير
 * التكرار بلا أثر، فلا جدول أحداث ولا مفتاح تكرار.
 *
 * ## لا بيانات شخصية
 *
 * لا بريد ولا اسم. معرّف العميل عند Lemon Squeezy يكفي للرجوع إليه هناك.
 */

import type { SqlClient } from './client.ts';
import { schemaRunner } from './archive.ts';

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id          text        PRIMARY KEY,
     domain      text        NOT NULL,
     status      text        NOT NULL,
     variant_id  text        NOT NULL,
     customer_id text        NOT NULL,
     test_mode   boolean     NOT NULL DEFAULT false,
     ends_at     timestamptz,
     updated_at  timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS subscriptions_domain_idx ON subscriptions (domain)`,
];

export interface Subscription {
  id: string;
  domain: string;
  status: string;
  variantId: string;
  customerId: string;
  testMode: boolean;
  endsAt: Date | null;
  updatedAt: Date;
}

export interface SubscriptionLedger {
  /**
   * يكتب الحالة إن كانت أحدث ممّا عندنا — ويُرجع ما صار محفوظاً، أحدثَ
   * كان الوارد أم أقدم.
   */
  apply(sub: Subscription): Promise<Subscription>;
  get(id: string): Promise<Subscription | null>;
}

interface Row {
  id: string;
  domain: string;
  status: string;
  variant_id: string;
  customer_id: string;
  test_mode: boolean;
  ends_at: Date | string | null;
  updated_at: Date | string;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function fromRow(row: Row): Subscription {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    variantId: row.variant_id,
    customerId: row.customer_id,
    testMode: row.test_mode,
    endsAt: row.ends_at === null ? null : asDate(row.ends_at),
    updatedAt: asDate(row.updated_at),
  };
}

const COLUMNS = 'id, domain, status, variant_id, customer_id, test_mode, ends_at, updated_at';

export function sqlSubscriptions(client: SqlClient): SubscriptionLedger {
  const run = schemaRunner(client, MIGRATIONS);

  const get = async (id: string): Promise<Subscription | null> => {
    const rows = await run<Row>(`SELECT ${COLUMNS} FROM subscriptions WHERE id = $1`, [id]);
    return rows[0] === undefined ? null : fromRow(rows[0]);
  };

  return {
    async apply(sub) {
      // `>=` لا `>`: الحدث نفسه يُعاد فيُكتب كما هو، بلا ضرر.
      await run(
        `INSERT INTO subscriptions (${COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
           SET domain = EXCLUDED.domain, status = EXCLUDED.status,
               variant_id = EXCLUDED.variant_id, customer_id = EXCLUDED.customer_id,
               test_mode = EXCLUDED.test_mode, ends_at = EXCLUDED.ends_at,
               updated_at = EXCLUDED.updated_at
         WHERE EXCLUDED.updated_at >= subscriptions.updated_at`,
        [
          sub.id,
          sub.domain.toLowerCase().replace(/^www\./, ''),
          sub.status,
          sub.variantId,
          sub.customerId,
          sub.testMode,
          sub.endsAt?.toISOString() ?? null,
          sub.updatedAt.toISOString(),
        ]
      );
      const stored = await get(sub.id);
      if (stored === null) throw new Error('subscription vanished after write');
      return stored;
    },
    get,
  };
}
