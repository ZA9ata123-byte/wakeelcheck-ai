import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { BuyingQuestion, Digest } from '@wakeelcheck/core';
import type { SqlClient } from '../src/client.ts';
import { sqlMonitors } from '../src/monitors.ts';

/** سجلّ المتابعة على Postgres حقيقيّ. */

function pglite(db: PGlite): SqlClient {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await db.query<T>(text, [...params])).rows;
    },
  };
}

async function fresh() {
  const db = new PGlite();
  return { db, monitors: sqlMonitors(pglite(db)) };
}

const at = (iso: string): Date => new Date(iso);
const DAY = 86_400_000;

const QUESTIONS: BuyingQuestion[] = [
  { id: 'q1', text: 'وش أفضل متجر عبايات في الرياض؟', intent: 'discovery' },
  { id: 'q2', text: 'عبايات بأقل من 300 ريال؟', intent: 'price' },
];

// ── التسجيل ──────────────────────────────────────────────────

test('التسجيل يُنشئ متابعةً مفعّلة بلا أسئلة بعد', async () => {
  const { db, monitors } = await fresh();
  await monitors.enroll({ domain: 'WWW.Noura.SA', url: 'https://noura.sa', locale: 'ar', at: at('2026-10-01T00:00:00Z') });

  const m = await monitors.get('noura.sa');
  assert.equal(m?.domain, 'noura.sa', 'مطبَّعٌ كما يُطبَّع الكاش');
  assert.equal(m?.active, true);
  assert.equal(m?.questions, null);
  assert.equal(m?.lastRunAt, null);
  await db.close();
});

test('إعادة التسجيل تُفعّل ولا تمسّ الأسئلة', async () => {
  const { db, monitors } = await fresh();
  await monitors.enroll({ domain: 'noura.sa', url: 'https://noura.sa', locale: 'ar', at: at('2026-10-01T00:00:00Z') });
  await monitors.setQuestions('noura.sa', QUESTIONS);
  await monitors.deactivate('noura.sa');

  await monitors.enroll({ domain: 'noura.sa', url: 'https://noura.sa', locale: 'en', at: at('2026-10-05T00:00:00Z') });

  const m = await monitors.get('noura.sa');
  assert.equal(m?.active, true);
  assert.deepEqual(m?.questions, QUESTIONS, 'الأسئلة باقية — وإلّا انقطعت المقارنة');
  assert.equal(m?.createdAt.toISOString(), '2026-10-01T00:00:00.000Z', 'تاريخ البداية لا يتغيّر');
  await db.close();
});

// ── الأسئلة الثابتة ──────────────────────────────────────────

test('الأسئلة تُكتب مرّةً ولا يُكتب فوقها', async () => {
  // هذا ما يجعل الأسبوعين قابلَين للمقارنة.
  const { db, monitors } = await fresh();
  await monitors.enroll({ domain: 'noura.sa', url: 'https://noura.sa', locale: 'ar', at: at('2026-10-01T00:00:00Z') });

  const first = await monitors.setQuestions('noura.sa', QUESTIONS);
  const second = await monitors.setQuestions('noura.sa', [{ id: 'x', text: 'سؤالٌ آخر؟', intent: 'discovery' }]);

  assert.deepEqual(first, QUESTIONS);
  assert.deepEqual(second, QUESTIONS, 'الثانية تُرجع المحفوظ لا الجديد');
  assert.deepEqual((await monitors.get('noura.sa'))?.questions, QUESTIONS);
  await db.close();
});

test('نصّ السؤال يُحفظ حرفاً بحرف', async () => {
  const { db, monitors } = await fresh();
  await monitors.enroll({ domain: 'noura.sa', url: 'https://noura.sa', locale: 'ar', at: at('2026-10-01T00:00:00Z') });
  const exact: BuyingQuestion[] = [{ id: 'q1', text: '  وش أفضلُ «متجر» عبايات؟\n', intent: 'discovery' }];

  await monitors.setQuestions('noura.sa', exact);
  assert.equal((await monitors.get('noura.sa'))?.questions?.[0]?.text, exact[0]?.text);
  await db.close();
});

// ── المستحقّ ─────────────────────────────────────────────────

test('المستحقّ: ما لم يُفحص قطّ أولاً، ثم الأقدم', async () => {
  const { db, monitors } = await fresh();
  const now = at('2026-10-15T00:00:00Z');
  for (const d of ['a.sa', 'b.sa', 'c.sa', 'd.sa']) {
    await monitors.enroll({ domain: d, url: `https://${d}`, locale: 'ar', at: at('2026-10-01T00:00:00Z') });
  }
  await monitors.markRun('a.sa', new Date(now.getTime() - 9 * DAY), 'r-a'); // مستحقّ
  await monitors.markRun('b.sa', new Date(now.getTime() - 3 * DAY), 'r-b'); // ليس بعد
  await monitors.markRun('c.sa', new Date(now.getTime() - 8 * DAY), 'r-c'); // مستحقّ
  // d.sa لم يُفحص قطّ

  const due = await monitors.due(now, 7, 10);
  assert.deepEqual(due.map((m) => m.domain), ['d.sa', 'a.sa', 'c.sa']);
  await db.close();
});

test('المعطَّل ليس مستحقّاً، والحدّ يُحترم', async () => {
  const { db, monitors } = await fresh();
  for (const d of ['a.sa', 'b.sa', 'c.sa']) {
    await monitors.enroll({ domain: d, url: `https://${d}`, locale: 'ar', at: at('2026-10-01T00:00:00Z') });
  }
  await monitors.deactivate('b.sa');

  const due = await monitors.due(at('2026-10-15T00:00:00Z'), 7, 1);
  assert.equal(due.length, 1);
  assert.notEqual(due[0]?.domain, 'b.sa');
  await db.close();
});

test('الفحص يُسجَّل بوقته وتقريره', async () => {
  const { db, monitors } = await fresh();
  await monitors.enroll({ domain: 'noura.sa', url: 'https://noura.sa', locale: 'ar', at: at('2026-10-01T00:00:00Z') });
  await monitors.markRun('noura.sa', at('2026-10-08T03:00:00Z'), 'report-7');

  const m = await monitors.get('noura.sa');
  assert.equal(m?.lastRunAt?.toISOString(), '2026-10-08T03:00:00.000Z');
  assert.equal(m?.lastReport, 'report-7');
  await db.close();
});

// ── النشرات ──────────────────────────────────────────────────

test('النشرة تُحفظ بتقريرها وتُقرأ كما هي', async () => {
  const { db, monitors } = await fresh();
  const digest: Digest = {
    tone: 'alert',
    headline: { ar: 'noura.sa اختفى من ChatGPT هذا الأسبوع', en: 'noura.sa dropped out of ChatGPT this week' },
    lines: [{ ar: 'اختفيتَ من إجابات ChatGPT.', en: "You dropped out of ChatGPT's answers." }],
    basis: { ar: 'قارنّا سؤالين على محرّكٍ واحد.', en: 'We compared 2 questions across 1 engine.' },
  };

  await monitors.saveDigest({ reportId: 'report-7', domain: 'noura.sa', digest, at: at('2026-10-08T03:00:00Z') });

  assert.deepEqual(await monitors.digestFor('report-7'), digest);
  assert.equal(await monitors.digestFor('report-x'), null);
  await db.close();
});
