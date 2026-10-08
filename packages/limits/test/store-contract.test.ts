import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, type KeyValueStore } from '../src/store.ts';
import { redisStore, StoreUnavailableError } from '../src/redis.ts';
import { admit, consumeIpQuota, recordSpend, checkBudget, setCachedScan } from '../src/guards.ts';
import { FAKE_TOKEN, FAKE_URL, fakeUpstash } from './fake-upstash.ts';

/**
 * عقدٌ واحد، تطبيقان.
 *
 * كلّ ما تقوم عليه الحدود — الكاش والسقف ورصيد الزائر — يمرّ من الدوال
 * الأربع. فإن اختلف Redis عن الذاكرة في واحدةٍ منها، عملت الحدود في
 * الاختبار وفشلت في الإنتاج. فالاختبارات نفسها تجري على الاثنين.
 */

interface Impl {
  name: string;
  make(clock: () => number): KeyValueStore;
}

const IMPLS: Impl[] = [
  { name: 'memory', make: (clock) => memoryStore({ now: clock }) },
  {
    name: 'redis',
    make: (clock) => redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: fakeUpstash(clock).fetch }),
  },
];

for (const impl of IMPLS) {
  const clocked = () => {
    let t = 1_700_000_000_000;
    return { store: impl.make(() => t), advance: (s: number) => (t += s * 1000) };
  };

  test(`${impl.name}: ما لم يُكتب null`, async () => {
    assert.equal(await clocked().store.get('nothing'), null);
  });

  test(`${impl.name}: الكتابة تُقرأ كما هي`, async () => {
    const { store } = clocked();
    await store.set('k', 'قيمة عربية', 60);
    assert.equal(await store.get('k'), 'قيمة عربية');
  });

  test(`${impl.name}: الانتهاء يُحترم`, async () => {
    const { store, advance } = clocked();
    await store.set('k', 'v', 10);
    advance(9);
    assert.equal(await store.get('k'), 'v');
    advance(2);
    assert.equal(await store.get('k'), null);
  });

  test(`${impl.name}: بلا مدّة لا ينتهي`, async () => {
    const { store, advance } = clocked();
    await store.set('k', 'v');
    advance(10 * 86_400);
    assert.equal(await store.get('k'), 'v');
  });

  test(`${impl.name}: الزيادة تُرجع القيمة بعدها`, async () => {
    const { store } = clocked();
    assert.equal(await store.incrBy('n', 5, 60), 5);
    assert.equal(await store.incrBy('n', 3, 60), 8);
    assert.equal(await store.get('n'), '8');
  });

  test(`${impl.name}: النافذة تبدأ عند أول زيادة ولا تتجدّد`, async () => {
    // وإلّا لأبقت طلباتٌ متتابعة العدّادَ حيّاً إلى الأبد، ولم يُصفَّر رصيدٌ قطّ.
    const { store, advance } = clocked();
    await store.incrBy('n', 1, 10);
    advance(8);
    await store.incrBy('n', 1, 10);
    advance(3);
    assert.equal(await store.get('n'), null, 'انتهت بعد عشرٍ من الأولى لا من الثانية');
  });

  test(`${impl.name}: الحذف يمحو`, async () => {
    const { store } = clocked();
    await store.set('k', 'v', 60);
    await store.del('k');
    assert.equal(await store.get('k'), null);
  });

  test(`${impl.name}: رصيد الزائر يُصفَّر بعد يوم`, async () => {
    const { store, advance } = clocked();
    for (let i = 0; i < 3; i++) assert.equal((await consumeIpQuota(store, 'ip', 3)).allowed, true);
    assert.equal((await consumeIpQuota(store, 'ip', 3)).allowed, false);

    advance(86_400 + 1);
    assert.equal((await consumeIpQuota(store, 'ip', 3)).allowed, true);
  });

  test(`${impl.name}: الإنفاق يتراكم في الشهر`, async () => {
    const { store } = clocked();
    const now = new Date('2026-10-08T00:00:00Z');
    await recordSpend(store, 400_000, now);
    await recordSpend(store, 700_000, now);

    const budget = await checkBudget(store, 1, now);
    assert.equal(budget.spentMicros, 1_100_000);
    assert.equal(budget.withinBudget, false);
  });
}

// ── ما يخصّ Redis وحده: المشاركة والأعطال ───────────────────

test('نسختان على Redis واحد تتقاسمان العدّاد', async () => {
  // هذا سبب وجود #3 كلّه. على الذاكرة، لكلّ نسخةٍ ثلاثة فحوص؛ هنا ثلاثة للجميع.
  const server = fakeUpstash();
  const a = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });
  const b = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });

  await consumeIpQuota(a, 'ip', 3);
  await consumeIpQuota(b, 'ip', 3);
  await consumeIpQuota(a, 'ip', 3);

  assert.equal((await consumeIpQuota(b, 'ip', 3)).allowed, false, 'الرابع يُرفض أينما وصل');
});

test('الكاش الذي كتبته نسخةٌ تراه الأخرى', async () => {
  const server = fakeUpstash();
  const a = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });
  const b = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });
  const input = {
    domain: 'shop.sa',
    kind: 'quick' as const,
    ipHash: 'x',
    perIpPerDay: 3,
    maxMonthlyUsd: 20,
    cacheTtlHours: 24,
    now: new Date('2026-10-08T00:00:00Z'),
  };

  await setCachedScan(a, 'shop.sa', 'quick', 'scan-1', { ttlHours: 1 });
  assert.deepEqual(await admit(b, input), { reason: 'cached', scanId: 'scan-1' });
});

test('الشبكة الساقطة خطأٌ صريح لا قيمةٌ فارغة', async () => {
  // `null` من مخزنٍ ساقط تعني «لا كاش، لا إنفاق، لا رصيد مستهلك» — أي فتح
  // الأبواب كلّها. فالسقوط يُرمى، والمسار يقرّر.
  const server = fakeUpstash();
  const store = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });

  for (const mode of ['network', 'http500', 'redis-error'] as const) {
    server.fail(mode);
    await assert.rejects(store.get('k'), StoreUnavailableError, mode);
    await assert.rejects(store.incrBy('k', 1, 60), StoreUnavailableError, mode);
  }
});

test('رمزٌ خاطئ يُرفض ولا يظهر في الخطأ', async () => {
  // القاعدة 01: الخطأ يصل إلى سجلّ أو ردّ.
  const server = fakeUpstash();
  const secret = ['wrong', 'token', 'value'].join('-');
  const store = redisStore({ url: FAKE_URL, token: secret, fetch: server.fetch });

  const err = await store.get('k').catch((e: unknown) => e);
  assert.ok(err instanceof StoreUnavailableError);
  assert.ok(!err.message.includes(secret), err.message);
  assert.ok(!err.message.includes(FAKE_URL), 'ولا الرابط');
});

test('الشرطة الأخيرة في الرابط لا تكسر شيئاً', async () => {
  const server = fakeUpstash();
  const store = redisStore({ url: `${FAKE_URL}/`, token: FAKE_TOKEN, fetch: server.fetch });

  await store.set('k', 'v');
  assert.equal(await store.get('k'), 'v');
});

test('الزيادة لا تجدّد المهلة بنداءٍ زائد', async () => {
  // ثلاثة أوامر في الأولى (INCRBY ثم TTL ثم EXPIRE)، واثنان بعدها. لو ضُبطت
  // المهلة كلّ مرّة لتجدّدت النافذة — الخلل الذي يمنعه اختبار العقد أعلاه.
  const server = fakeUpstash();
  const store = redisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: server.fetch });

  await store.incrBy('n', 1, 60);
  await store.incrBy('n', 1, 60);

  assert.deepEqual(
    server.commands.map((c) => c[0]),
    ['INCRBY', 'TTL', 'EXPIRE', 'INCRBY', 'TTL']
  );
});
