import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScanResult } from '@wakeelcheck/core';
import { memoryStore, redisStore } from '@wakeelcheck/limits';
import { handleScanPost } from '../lib/scan-post';
import { RESULT_TTL_SECONDS, loadResult, saveResult, storeFromEnv } from '../lib/store';
import { FAKE_TOKEN, FAKE_URL, fakeUpstash } from '../../../packages/limits/test/fake-upstash';
import { harness, post } from './fixture';

/**
 * #3 من جهة الموقع: أيّ مخزنٍ يعمل، وهل يراه الجميع.
 *
 * أهمّ اختبارٍ هنا «نسختان، Redis واحد»: هو ما تفعله المنصّة تحت الضغط،
 * وهو ما لم يكن يعمل قبل هذا.
 */

const env = (vars: Record<string, string>) => (name: string) => vars[name];

// ── الاختيار من البيئة ───────────────────────────────────────

test('بلا متغيّرات: الذاكرة', () => {
  assert.equal(storeFromEnv(env({})).kind, 'memory');
});

test('زوج Upstash: Redis', () => {
  const vars = { UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN };
  assert.equal(storeFromEnv(env(vars)).kind, 'redis');
});

test('زوج تكامل Vercel: Redis أيضاً', () => {
  // ما يضعه التكامل تلقائياً يكفي — لا نسخ قيمةٍ من مكانٍ إلى آخر.
  const vars = { KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: FAKE_TOKEN };
  assert.equal(storeFromEnv(env(vars)).kind, 'redis');
});

test('نصف زوج: الذاكرة — ويُعلَن ذلك', () => {
  // رابطٌ بلا رمز لا يعمل. والإعلان في `/api/health` يكشفه للرئيس.
  assert.equal(storeFromEnv(env({ UPSTASH_REDIS_REST_URL: FAKE_URL })).kind, 'memory');
  assert.equal(storeFromEnv(env({ UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN })).kind, 'memory');
  assert.equal(storeFromEnv(env({ UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' })).kind, 'memory');
});

test('لا خلط بين زوجين', () => {
  // رابطٌ من واحد ورمزٌ من آخر قاعدتان مختلفتان.
  const vars = { UPSTASH_REDIS_REST_URL: FAKE_URL, KV_REST_API_TOKEN: FAKE_TOKEN };
  assert.equal(storeFromEnv(env(vars)).kind, 'memory');
});

// ── النتائج ──────────────────────────────────────────────────

function sample(id: string): ScanResult {
  return {
    id,
    kind: 'quick',
    status: 'done',
    profile: null,
    questions: [],
    answers: [],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 0, byEngine: [] },
  };
}

test('النتيجة تُحفظ وتُقرأ كما هي', async () => {
  const store = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: fakeUpstash().fetch });
  await saveResult(store, sample('abc'));

  assert.deepEqual(await loadResult(store, 'abc'), sample('abc'));
  assert.equal(await loadResult(store, 'missing'), null);
});

test('نتيجةٌ فاسدة تُقرأ غياباً لا انهياراً', async () => {
  const store = memoryStore();
  await store.set('result:bad', '{not json', 60);

  assert.equal(await loadResult(store, 'bad'), null);
});

test('النتيجة تعيش أطول من الكاش الذي يشير إليها', () => {
  // معرّفٌ يعيده الكاش بعد 23 ساعة يجب أن تبقى نتيجته حيّة.
  assert.ok(RESULT_TTL_SECONDS > 24 * 3600);
});

test('النتيجة والكاش لا يتصادمان في المفاتيح', async () => {
  // الكاش `scan:quick:<نطاق>`، والنتيجة `result:<معرّف>`.
  const store = memoryStore();
  await store.set('scan:quick:shop.sa', 'scan-1', 60);
  await saveResult(store, sample('scan:quick:shop.sa'));

  assert.equal(await store.get('scan:quick:shop.sa'), 'scan-1', 'الكاش لم يُكتب فوقه');
});

// ── نسختان، Redis واحد ───────────────────────────────────────

test('ما فحصته نسخةٌ تجده الأخرى — الكاش والنتيجة معاً', async () => {
  const server = fakeUpstash();
  const a = harness({ store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }) });
  const b = harness({ store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }) });

  const first = await handleScanPost(post('daralanaqa.sa'), a.deps);
  const { scanId } = (await first.json()) as { scanId: string };
  await a.flush();

  // زائرٌ آخر يصل نسخةً أخرى: الكاش يجيب، ولم يُبدأ فحصٌ ثانٍ.
  const second = await handleScanPost(post('daralanaqa.sa', '198.51.100.9'), b.deps);
  assert.deepEqual(await second.json(), { scanId, cached: true });
  assert.equal(b.started(), 0);

  // والنتيجة التي يشير إليها المعرّف موجودة هناك — لا «جارٍ» إلى الأبد.
  assert.equal((await loadResult(b.store, scanId))?.status, 'done');
});

test('حدّ الزائر مشتركٌ بين النسخ', async () => {
  // على الذاكرة: ثلاثةٌ في كلّ نسخة. هنا: ثلاثةٌ للزائر أينما وصل.
  const server = fakeUpstash();
  const instances = [0, 1, 2, 3].map(() =>
    harness({ store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }) })
  );

  const statuses: number[] = [];
  for (const [i, h] of instances.entries()) {
    statuses.push((await handleScanPost(post(`store-${i}.sa`), h.deps)).status);
  }

  assert.deepEqual(statuses, [202, 202, 202, 429]);
});

test('السقف الشهريّ مشتركٌ بين النسخ', async () => {
  const server = fakeUpstash();
  const make = () =>
    harness({
      store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }),
      engineMicros: 600_000,
      env: { MAX_MONTHLY_SPEND_USD: '1' },
    });
  const a = make();
  const b = make();

  await handleScanPost(post('first.sa'), a.deps);
  await a.flush();

  const res = await handleScanPost(post('second.sa', '198.51.100.9'), b.deps);
  assert.equal(res.status, 503, 'ما أنفقته نسخةٌ يُحسب على الأخرى');
});

// ── المخزن الساقط ────────────────────────────────────────────

test('المخزن الساقط يُغلق الباب ولا يفتحه', async () => {
  // لو قُرئ السقوط «لا كاش ولا إنفاق ولا رصيد» لصار عطلُ Redis دعوةً لحرق
  // الميزانية. فيُرفض الفحص ولا يُبدأ.
  const server = fakeUpstash();
  const h = harness({ store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }) });
  server.fail('network');

  const res = await handleScanPost(post('daralanaqa.sa'), h.deps);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'store_unavailable' });
  assert.equal(h.started(), 0);
});

test('مخزنٌ يسقط أثناء الفحص لا يُسقط الوعد', async () => {
  // `after()` لا يرى الرفض. فالفحص يكمل، ولا يُرمى شيء.
  const server = fakeUpstash();
  const h = harness({ store: redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch }) });

  const res = await handleScanPost(post('daralanaqa.sa'), h.deps);
  assert.equal(res.status, 202);
  server.fail('http500');

  await assert.doesNotReject(h.flush());
});
