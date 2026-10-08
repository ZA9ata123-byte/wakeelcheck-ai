import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { EngineAnswer, ScanResult } from '@wakeelcheck/core';
import type { SqlClient } from '../src/client.ts';
import { ArchiveUnavailableError, sqlArchive } from '../src/archive.ts';

/**
 * الأرشيف على Postgres حقيقيّ — PGlite داخل العملية.
 *
 * لا محاكاة للـSQL: ما يجري هنا هو نفسه ما يجري على Neon. فخطأ في استعلامٍ
 * أو في تحويل `jsonb` يظهر هنا لا في الإنتاج.
 */

function pglite(db: PGlite): SqlClient {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await db.query<T>(text, [...params])).rows;
    },
  };
}

async function fresh() {
  const db = new PGlite();
  return { db, archive: sqlArchive(pglite(db)) };
}

function answer(text: string): EngineAnswer {
  return {
    questionId: 'q1',
    engine: 'chatgpt',
    answerText: text,
    citedUrls: ['https://baitalabaya.sa/'],
    storeMentioned: false,
    competitors: [{ name: 'بيت الأناقة', domain: 'baitalabaya.sa', position: 1 }],
    capturedAt: '2026-10-08T09:00:00.000Z',
    costMicros: 21_700,
  };
}

function report(id: string, over: Partial<ScanResult> = {}): ScanResult {
  return {
    id,
    kind: 'quick',
    status: 'done',
    profile: null,
    questions: [{ id: 'q1', text: 'وش أفضل متجر عبايات؟', intent: 'discovery' }],
    answers: [answer('من أبرز الخيارات بيت الأناقة.')],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 1, byEngine: [] },
    ...over,
  };
}

const at = (iso: string): Date => new Date(iso);

// ── الحفظ والقراءة ───────────────────────────────────────────

test('التقرير يُحفظ ويُقرأ كما هو', async () => {
  const { db, archive } = await fresh();
  await archive.save({ domain: 'shop.sa', result: report('r1'), costMicros: 43_400, at: at('2026-10-08T09:00:00Z') });

  assert.deepEqual(await archive.get('r1'), report('r1'));
  await db.close();
});

test('القاعدة 05: نصّ الإجابة يخرج حرفاً بحرف', async () => {
  // عربيّ بتشكيل، وأسطرٌ جديدة، واقتباسات، ورموزٌ تعبيرية، ومسافاتٌ في الطرفين،
  // وشَرطاتٌ عكسية. `jsonb` يعيد ترتيب المفاتيح — لا يمسّ قيم النصوص.
  const verbatim =
    '  مِنْ أبرزِ الخياراتِ «بيت الأناقة» — تصاميم راقية.\n\n' +
    '1. "لمسة رقي": توصيل خلال 24 ساعة ✨\n' +
    'المسار: C:\\shop\\abaya\t(تبويب)\r\nنهاية  ';

  const { db, archive } = await fresh();
  await archive.save({
    domain: 'shop.sa',
    result: report('r1', { answers: [answer(verbatim)] }),
    costMicros: 0,
    at: at('2026-10-08T09:00:00Z'),
  });

  const back = await archive.get('r1');
  assert.equal(back?.answers[0]?.answerText, verbatim);
  await db.close();
});

test('معرّفٌ غير موجود: null لا خطأ', async () => {
  const { db, archive } = await fresh();
  assert.equal(await archive.get('nothing'), null);
  await db.close();
});

test('المعرّف معاملٌ لا نصٌّ مدموج — لا حقن', async () => {
  const { db, archive } = await fresh();
  await archive.save({ domain: 'shop.sa', result: report('r1'), costMicros: 0, at: at('2026-10-08T09:00:00Z') });

  assert.equal(await archive.get("r1' OR '1'='1"), null);
  assert.equal(await archive.get("x'; DROP TABLE scan_reports; --"), null);
  assert.notEqual(await archive.get('r1'), null, 'الجدول باقٍ');
  await db.close();
});

test('الحفظ مرّتين يُحدّث ولا يُكرّر، وتاريخ الإنشاء يبقى', async () => {
  const { db, archive } = await fresh();
  await archive.save({ domain: 'shop.sa', result: report('r1', { status: 'running' }), costMicros: 0, at: at('2026-10-08T09:00:00Z') });
  await archive.save({ domain: 'shop.sa', result: report('r1'), costMicros: 43_400, at: at('2026-10-09T09:00:00Z') });

  const rows = (await db.query<{ n: number; created: Date; cost: number }>(
    'SELECT count(*)::int AS n, min(created_at) AS created, max(cost_micros)::int AS cost FROM scan_reports'
  )).rows;
  assert.equal(rows[0]?.n, 1);
  assert.equal(rows[0]?.created.toISOString(), '2026-10-08T09:00:00.000Z');
  assert.equal(rows[0]?.cost, 43_400);
  assert.equal((await archive.get('r1'))?.status, 'done');
  await db.close();
});

// ── التاريخ — ما تقارنه المتابعة الأسبوعية ───────────────────

test('التاريخ: الأحدث أولاً، والمكتمل وحده', async () => {
  const { db, archive } = await fresh();
  await archive.save({ domain: 'shop.sa', result: report('week1'), costMicros: 0, at: at('2026-10-01T09:00:00Z') });
  await archive.save({ domain: 'shop.sa', result: report('week2'), costMicros: 0, at: at('2026-10-08T09:00:00Z') });
  await archive.save({ domain: 'shop.sa', result: report('broken', { status: 'failed' }), costMicros: 0, at: at('2026-10-09T09:00:00Z') });
  await archive.save({ domain: 'other.sa', result: report('other'), costMicros: 0, at: at('2026-10-10T09:00:00Z') });

  const history = await archive.history('shop.sa', 'quick', 10);
  assert.deepEqual(history.map((r) => r.id), ['week2', 'week1']);
  await db.close();
});

test('التاريخ يطابق النطاق بأيّ صيغة كُتب', async () => {
  // كما يطابقه الكاش: `www.` والحروف الكبيرة لا تصنع متجراً آخر.
  const { db, archive } = await fresh();
  await archive.save({ domain: 'WWW.Shop.SA', result: report('r1'), costMicros: 0, at: at('2026-10-08T09:00:00Z') });

  // يُطبَّع عند الحفظ **وعند البحث** — وإلّا ضاع تاريخ من كتب الرابط بصيغةٍ أخرى.
  assert.deepEqual((await archive.history('shop.sa', 'quick', 5)).map((r) => r.id), ['r1']);
  assert.deepEqual((await archive.history('www.SHOP.sa', 'quick', 5)).map((r) => r.id), ['r1']);
  await db.close();
});

test('التاريخ يحترم الحدّ ونوع الفحص', async () => {
  const { db, archive } = await fresh();
  for (let i = 1; i <= 4; i++) {
    await archive.save({ domain: 'shop.sa', result: report(`q${i}`), costMicros: 0, at: at(`2026-10-0${i}T09:00:00Z`) });
  }
  await archive.save({ domain: 'shop.sa', result: report('full', { kind: 'full' }), costMicros: 0, at: at('2026-10-09T09:00:00Z') });

  assert.deepEqual((await archive.history('shop.sa', 'quick', 2)).map((r) => r.id), ['q4', 'q3']);
  assert.deepEqual((await archive.history('shop.sa', 'full', 5)).map((r) => r.id), ['full']);
  await db.close();
});

// ── الترحيل والأعطال ─────────────────────────────────────────

test('الجدول يُنشأ وحده عند أوّل استعمال، ومرّةً واحدة', async () => {
  const db = new PGlite();
  const seen: string[] = [];
  const client: SqlClient = {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      seen.push(text.trim().split(/\s+/).slice(0, 2).join(' '));
      return (await db.query<T>(text, [...params])).rows;
    },
  };
  const archive = sqlArchive(client);

  await archive.get('a');
  await archive.get('b');
  assert.deepEqual(seen, ['CREATE TABLE', 'CREATE INDEX', 'SELECT result', 'SELECT result']);
  await db.close();
});

test('أرشيفان على قاعدةٍ واحدة لا يتعارضان في الإنشاء', async () => {
  // نسختان تبدآن معاً: كلتاهما تُنشئ `IF NOT EXISTS`.
  const db = new PGlite();
  const a = sqlArchive(pglite(db));
  const b = sqlArchive(pglite(db));

  await Promise.all([a.save({ domain: 'shop.sa', result: report('r1'), costMicros: 0, at: at('2026-10-08T09:00:00Z') }), b.get('r1')]);
  assert.notEqual(await b.get('r1'), null);
  await db.close();
});

test('عطل القاعدة خطأٌ صريح لا null — ولا يحمل نصّ الاتصال', async () => {
  // null من قاعدةٍ ساقطة تعني «التقرير غير موجود» — كذبٌ على التاجر.
  const secret = ['postgres://user', 'p4ss@host/db'].join(':');
  const broken: SqlClient = {
    async query() {
      throw new Error(`connect failed for ${secret}`);
    },
  };

  const err = await sqlArchive(broken).get('r1').catch((e: unknown) => e);
  assert.ok(err instanceof ArchiveUnavailableError);
  assert.ok(!err.message.includes('p4ss'), err.message);
});

test('ترحيلٌ سقط يُعاد في النداء التالي', async () => {
  // لا يُحفظ الفشل: انقطاعٌ لحظيّ عند أوّل طلب لا يُعطّل النسخة إلى الأبد.
  const db = new PGlite();
  let down = true;
  const flaky: SqlClient = {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      if (down) throw new Error('ECONNRESET');
      return (await db.query<T>(text, [...params])).rows;
    },
  };
  const archive = sqlArchive(flaky);

  await assert.rejects(archive.get('r1'), ArchiveUnavailableError);
  down = false;
  assert.equal(await archive.get('r1'), null, 'عاد ونجح');
  await db.close();
});
