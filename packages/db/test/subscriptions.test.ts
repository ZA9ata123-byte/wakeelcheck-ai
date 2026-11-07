import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { SqlClient } from '../src/client.ts';
import { sqlSubscriptions, type Subscription } from '../src/subscriptions.ts';

/** سجلّ الاشتراكات على Postgres حقيقيّ: الأحدث يغلب، والتكرار بلا أثر. */

function ledger() {
  const db = new PGlite();
  const client: SqlClient = {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await db.query<T>(text, [...params])).rows;
    },
  };
  return sqlSubscriptions(client);
}

const sub = (status: string, updatedAt: string, extra: Partial<Subscription> = {}): Subscription => ({
  id: '42',
  domain: 'WWW.Noura.SA',
  status,
  variantId: '7',
  customerId: '9',
  testMode: true,
  endsAt: null,
  updatedAt: new Date(updatedAt),
  email: 'owner@noura.example',
  locale: 'ar',
  ...extra,
});

test('أوّل حدث يُكتب، والنطاق مطبَّع كما يُطبَّع في المتابعة', async () => {
  const l = ledger();
  const stored = await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  assert.equal(stored.domain, 'noura.sa');
  assert.equal(stored.status, 'active');
  assert.equal(stored.testMode, true);
});

test('حدثٌ أحدث يكتب فوق الأقدم', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  const ends = new Date('2026-12-01T10:00:00Z');
  const stored = await l.apply(sub('cancelled', '2026-11-02T10:00:00Z', { endsAt: ends }));
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.endsAt?.toISOString(), ends.toISOString());
});

test('حدثٌ أقدم وصل متأخراً لا يُعيد ما تغيّر — ويُرجع المحفوظ', async () => {
  const l = ledger();
  await l.apply(sub('expired', '2026-11-05T10:00:00Z'));
  const stored = await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  assert.equal(stored.status, 'expired');
  assert.equal((await l.get('42'))?.status, 'expired');
});

test('الحدث نفسه مرّتين بلا أثر', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  const again = await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  assert.equal(again.status, 'active');
});

test('اشتراكٌ لا نعرفه: null', async () => {
  assert.equal(await ledger().get('nope'), null);
});

// ── من تُرسل إليهم النشرة ────────────────────────────────────

const ENTITLED = ['on_trial', 'active', 'past_due', 'cancelled'];

test('المستحقّ ببريده يُرجَع، والمنتهي لا', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z', { id: 'a', locale: 'en' }));
  await l.apply(sub('expired', '2026-11-01T10:00:00Z', { id: 'b', email: 'gone@noura.example' }));
  assert.deepEqual(await l.recipients('www.noura.sa', ENTITLED), [
    { email: 'owner@noura.example', locale: 'en' },
  ]);
});

test('بلا بريد: لا يُرجَع، ولا يُمسح بريدٌ قائم بحدثٍ بلا بريد', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  await l.apply(sub('active', '2026-11-02T10:00:00Z', { email: null }));
  assert.equal((await l.get('42'))?.email, 'owner@noura.example');

  const m = ledger();
  await m.apply(sub('active', '2026-11-01T10:00:00Z', { email: null }));
  assert.deepEqual(await m.recipients('noura.sa', ENTITLED), []);
});

test('بريدٌ واحد مرّةً واحدة وإن تكرّر في اشتراكين', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z', { id: 'a' }));
  await l.apply(sub('on_trial', '2026-11-03T10:00:00Z', { id: 'b', email: 'OWNER@noura.example' }));
  assert.equal((await l.recipients('noura.sa', ENTITLED)).length, 1);
});

test('نطاقٌ آخر لا يرى بريد غيره', async () => {
  const l = ledger();
  await l.apply(sub('active', '2026-11-01T10:00:00Z'));
  assert.deepEqual(await l.recipients('other.sa', ENTITLED), []);
});
