import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  admit,
  checkBudget,
  consumeIpQuota,
  getCachedScan,
  hashIp,
  peekIpQuota,
  recordSpend,
  setCachedScan,
} from '../src/guards.ts';
import { memoryStore } from '../src/store.ts';

const NOW = new Date('2026-08-27T12:00:00Z');

/** ساعة قابلة للتحريك — انتهاء الصلاحية يُختبر لحظياً بلا انتظار. */
function clockedStore(startMs = NOW.getTime()) {
  let current = startMs;
  const store = memoryStore({ now: () => current });
  return { store, advance: (seconds: number) => (current += seconds * 1000) };
}

// ── تجزئة العنوان ────────────────────────────────────────────

test('hashIp never returns the address itself', () => {
  const hashed = hashIp('89.34.12.7', 'salt');

  assert.notEqual(hashed, '89.34.12.7');
  assert.ok(!hashed.includes('89.34'));
  assert.equal(hashed.length, 32);
});

test('hashIp is stable for the same address and salt', () => {
  assert.equal(hashIp('1.2.3.4', 's'), hashIp('1.2.3.4', 's'));
});

test('a different salt gives a different hash', () => {
  assert.notEqual(hashIp('1.2.3.4', 'a'), hashIp('1.2.3.4', 'b'));
});

// ── الكاش ────────────────────────────────────────────────────

test('a cached scan is returned for the same domain', async () => {
  const store = memoryStore();
  await setCachedScan(store, 'shop.sa', 'quick', 'scan-1', { ttlHours: 24 });

  assert.equal(await getCachedScan(store, 'shop.sa', 'quick'), 'scan-1');
});

test('the cache key ignores www and letter case', async () => {
  const store = memoryStore();
  await setCachedScan(store, 'www.Shop.SA', 'quick', 'scan-1', { ttlHours: 24 });

  assert.equal(await getCachedScan(store, 'shop.sa', 'quick'), 'scan-1');
});

test('a quick scan does not satisfy a full scan', async () => {
  const store = memoryStore();
  await setCachedScan(store, 'shop.sa', 'quick', 'scan-1', { ttlHours: 24 });

  assert.equal(await getCachedScan(store, 'shop.sa', 'full'), null);
});

test('the cache expires after its window', async () => {
  const { store, advance } = clockedStore();
  await setCachedScan(store, 'shop.sa', 'quick', 'scan-1', { ttlHours: 24 });

  advance(23 * 3600);
  assert.equal(await getCachedScan(store, 'shop.sa', 'quick'), 'scan-1');

  advance(2 * 3600);
  assert.equal(await getCachedScan(store, 'shop.sa', 'quick'), null);
});

// ── حدّ الزائر ───────────────────────────────────────────────

test('a visitor gets exactly the allowed number of scans', async () => {
  const store = memoryStore();
  const ip = hashIp('1.2.3.4', 's');

  for (let i = 1; i <= 3; i++) {
    const decision = await consumeIpQuota(store, ip, 3);
    assert.equal(decision.allowed, true, `attempt ${i} should pass`);
    assert.equal(decision.remaining, 3 - i);
  }

  assert.equal((await consumeIpQuota(store, ip, 3)).allowed, false, 'the fourth is refused');
});

test('quotas are per visitor, not global', async () => {
  const store = memoryStore();

  await consumeIpQuota(store, hashIp('1.1.1.1', 's'), 1);

  assert.equal((await consumeIpQuota(store, hashIp('2.2.2.2', 's'), 1)).allowed, true);
});

test('the quota resets after a day', async () => {
  const { store, advance } = clockedStore();
  const ip = hashIp('1.2.3.4', 's');

  await consumeIpQuota(store, ip, 1);
  assert.equal((await consumeIpQuota(store, ip, 1)).allowed, false);

  advance(86_401);
  assert.equal((await consumeIpQuota(store, ip, 1)).allowed, true);
});

test('the window does not slide with continued use', async () => {
  // بلا هذا يستطيع زائر إبقاء نافذته مفتوحة إلى الأبد بطلب كل ساعة.
  const { store, advance } = clockedStore();
  const ip = hashIp('1.2.3.4', 's');

  await consumeIpQuota(store, ip, 5);
  advance(20 * 3600);
  await consumeIpQuota(store, ip, 5);
  advance(5 * 3600);

  const after = await peekIpQuota(store, ip, 5);
  assert.equal(after.used, 0, 'the window should have closed 25 hours after the first hit');
});

test('a zero limit refuses everything', async () => {
  const store = memoryStore();
  assert.equal((await consumeIpQuota(store, 'ip', 0)).allowed, false);
});

test('peek does not consume', async () => {
  const store = memoryStore();
  const ip = hashIp('1.2.3.4', 's');

  await peekIpQuota(store, ip, 3);
  await peekIpQuota(store, ip, 3);

  assert.equal((await peekIpQuota(store, ip, 3)).used, 0);
});

// ── الميزانية ────────────────────────────────────────────────

test('spending accumulates within the month', async () => {
  const store = memoryStore();

  await recordSpend(store, 500_000, NOW);
  await recordSpend(store, 250_000, NOW);

  assert.equal((await checkBudget(store, 300, NOW)).spentMicros, 750_000);
});

test('the budget blocks once the cap is reached', async () => {
  const store = memoryStore();

  await recordSpend(store, 299_000_000, NOW);
  assert.equal((await checkBudget(store, 300, NOW)).withinBudget, true);

  await recordSpend(store, 2_000_000, NOW);
  assert.equal((await checkBudget(store, 300, NOW)).withinBudget, false);
});

test('the ratio supports warning before the cap', async () => {
  const store = memoryStore();
  await recordSpend(store, 240_000_000, NOW);

  assert.equal((await checkBudget(store, 300, NOW)).ratio, 0.8);
});

test('a new month starts from zero', async () => {
  const store = memoryStore();
  await recordSpend(store, 299_000_000, NOW);

  const nextMonth = new Date('2026-09-01T00:00:00Z');
  assert.equal((await checkBudget(store, 300, nextMonth)).spentMicros, 0);
});

test('a zero or negative amount is not recorded', async () => {
  const store = memoryStore();

  await recordSpend(store, 0, NOW);
  await recordSpend(store, -5, NOW);

  assert.equal((await checkBudget(store, 300, NOW)).spentMicros, 0);
});

// ── القرار المجمَّع ──────────────────────────────────────────

function input(over: Partial<Parameters<typeof admit>[1]> = {}) {
  return {
    domain: 'shop.sa',
    kind: 'quick' as const,
    ipHash: hashIp('1.2.3.4', 's'),
    perIpPerDay: 3,
    maxMonthlyUsd: 300,
    cacheTtlHours: 24,
    now: NOW,
    ...over,
  };
}

test('a fresh request is admitted', async () => {
  const decision = await admit(memoryStore(), input());

  assert.equal(decision.reason, 'ok');
  assert.equal(decision.rate?.remaining, 2);
});

test('a cached domain short-circuits before anything is charged', async () => {
  const store = memoryStore();
  await setCachedScan(store, 'shop.sa', 'quick', 'scan-42', { ttlHours: 24 });

  const decision = await admit(store, input());

  assert.equal(decision.reason, 'cached');
  assert.equal(decision.scanId, 'scan-42');

  // والأهم: لم تُستهلك محاولة من رصيد الزائر.
  assert.equal((await peekIpQuota(store, input().ipHash, 3)).used, 0);
});

test('a visitor over the daily limit is refused', async () => {
  const store = memoryStore();
  for (let i = 0; i < 3; i++) await admit(store, input({ domain: `s${i}.sa` }));

  assert.equal((await admit(store, input({ domain: 'other.sa' }))).reason, 'rate_limited');
});

test('an exhausted budget refuses everyone, cache aside', async () => {
  const store = memoryStore();
  await recordSpend(store, 400_000_000, NOW);

  assert.equal((await admit(store, input())).reason, 'budget_exceeded');
});

test('the cache still serves after the budget is exhausted', async () => {
  // فحص سبق دفع ثمنه لا يكلّف شيئاً — لا معنى لحجبه.
  const store = memoryStore();
  await recordSpend(store, 400_000_000, NOW);
  await setCachedScan(store, 'shop.sa', 'quick', 'scan-9', { ttlHours: 24 });

  assert.equal((await admit(store, input())).reason, 'cached');
});

test('a refused request does not consume budget headroom', async () => {
  const store = memoryStore();
  for (let i = 0; i < 4; i++) await admit(store, input({ domain: `s${i}.sa` }));

  assert.equal((await checkBudget(store, 300, NOW)).spentMicros, 0, 'admission alone costs nothing');
});
