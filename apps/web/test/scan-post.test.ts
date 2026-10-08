import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBudget } from '@wakeelcheck/limits';
import { DEFAULT_MONTHLY_USD, handleScanPost } from '../lib/scan-post';
import { NOW, harness, post } from './fixture';

/**
 * POST /api/scan — ما يراه الزائر.
 *
 * أوّل اختباراتٍ لـ`apps/web` (القاعدة 09). وأهمّها الثلاثة التي تثبت أن
 * الحرّاس صاروا حرّاساً: الإنفاق يُسجَّل فيُوقف السقفُ، والكاش يُكتب فلا
 * يُدفع ثمن متجرٍ مرّتين، والفحص يُجدوَل ولا يُترك.
 */

// ── المدخل ───────────────────────────────────────────────────

test('جسمٌ ليس JSON يُرفض', async () => {
  const h = harness();
  const req = new Request('https://aitchek.online/api/scan', { method: 'POST', body: 'x{' });
  const res = await handleScanPost(req, h.deps);

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid_body' });
  assert.equal(h.started(), 0);
});

test('رابطٌ غائب يُرفض', async () => {
  const h = harness();
  const res = await handleScanPost(post(42), h.deps);

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'url_required');
});

test('رابطٌ لا يُطبَّع يُرفض بلا فحص', async () => {
  const h = harness();
  const res = await handleScanPost(post('not a url'), h.deps);

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'invalid_url');
  assert.equal(h.started(), 0);
});

// ── الطريق السعيد ────────────────────────────────────────────

test('فحصٌ مقبول يعود فوراً ويُجدوَل ولا يُترك', async () => {
  const h = harness();
  const res = await handleScanPost(post('daralanaqa.sa'), h.deps);

  assert.equal(res.status, 202);
  const body = (await res.json()) as { scanId: string; cached: boolean; demo: boolean };
  assert.equal(body.cached, false);
  assert.equal(body.demo, false);

  // قبل التسوية: «جارٍ». بعدها: مكتمل. وهذا ما يضمنه `after()` في الإنتاج.
  assert.equal(h.scans.get(body.scanId)?.status, 'running');
  await h.flush();
  assert.equal(h.scans.get(body.scanId)?.status, 'done');
});

// ── الحارس الأول: الإنفاق ────────────────────────────────────

test('الإنفاق يُسجَّل بعد الفحص', async () => {
  // كان `recordSpend` لا يُستدعى قطّ، فيقرأ السقفُ صفراً دائماً.
  const h = harness({ engineMicros: 21_700, llmMicros: 300 });
  await handleScanPost(post('daralanaqa.sa'), h.deps);
  await h.flush();

  const { spentMicros } = await checkBudget(h.store, DEFAULT_MONTHLY_USD, NOW);

  // سريع: سؤالان × محرّك واحد، ونداءات النموذج: توصيف + أسئلة + استخراجان.
  assert.equal(spentMicros, 2 * 21_700 + 4 * 300);
});

test('السقف الشهريّ يُوقف القبول حين يُبلَغ', async () => {
  // فحصٌ واحد يتجاوز دولاراً، والسقف دولار. الثاني يُرفض قبل أن يُكلّف.
  const h = harness({ engineMicros: 600_000, env: { MAX_MONTHLY_SPEND_USD: '1' } });

  const first = await handleScanPost(post('first.sa'), h.deps);
  assert.equal(first.status, 202);
  await h.flush();

  const second = await handleScanPost(post('second.sa', '198.51.100.9'), h.deps);
  assert.equal(second.status, 503);
  assert.deepEqual(await second.json(), { error: 'budget_exceeded' });
  assert.equal(h.started(), 1, 'الثاني لم يُبدأ — لم يُدفع ثمنه');
});

test('السقف الافتراضي لا يتجاوز الرصيد الفعليّ', async () => {
  // كان 300 دولار والرصيد عشرون. سقفٌ أعلى من الرصيد ليس سقفاً.
  assert.ok(DEFAULT_MONTHLY_USD <= 20, `السقف الافتراضي ${DEFAULT_MONTHLY_USD}`);
});

// ── الحارس الثاني: الكاش ─────────────────────────────────────

test('المتجر الواحد لا يُدفع ثمنه مرّتين', async () => {
  // كان `setCachedScan` لا يُستدعى قطّ: تغريدةٌ تقول «جرّبوا على noon.com»
  // كانت ستعني ألف فحصٍ مدفوع لمتجرٍ واحد.
  const h = harness();

  const first = await handleScanPost(post('daralanaqa.sa'), h.deps);
  const { scanId } = (await first.json()) as { scanId: string };
  await h.flush();

  const second = await handleScanPost(post('daralanaqa.sa', '198.51.100.9'), h.deps);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { scanId, cached: true });
  assert.equal(h.started(), 1, 'فحصٌ واحد بُدئ لزائرَين');
});

test('الكاش يطابق الرابط بأيّ صيغة كُتب', async () => {
  const h = harness();
  await handleScanPost(post('https://www.daralanaqa.sa/'), h.deps);
  await h.flush();

  const again = await handleScanPost(post('daralanaqa.sa', '198.51.100.9'), h.deps);
  assert.equal(((await again.json()) as { cached: boolean }).cached, true);
});

test('الكاش لا يستهلك رصيد الزائر', async () => {
  // ثلاثة فحوص في اليوم. المحفوظ لا يُعدّ منها — لم يُكلّف شيئاً.
  const h = harness();
  await handleScanPost(post('daralanaqa.sa'), h.deps);
  await h.flush();

  for (let i = 0; i < 5; i++) {
    const res = await handleScanPost(post('daralanaqa.sa'), h.deps);
    assert.equal(res.status, 200, `المحاولة ${i + 1}`);
  }
});

test('الوضع التجريبي لا يُحفظ', async () => {
  // لو حُفظ ثم أُضيف المفتاح، خدم الكاشُ بياناتٍ نموذجية يوماً كاملاً.
  const h = harness({ demo: true });
  await handleScanPost(post('daralanaqa.sa'), h.deps);
  await h.flush();

  const again = await handleScanPost(post('daralanaqa.sa', '198.51.100.9'), h.deps);
  assert.equal(again.status, 202);
  assert.equal(h.started(), 2);
});

test('فحصٌ بلا إجابةٍ واحدة لا يُحفظ', async () => {
  // محرّكٌ ساقط: حفظُ النتيجة يحبس التاجر في «لم يُقَس» يوماً كاملاً.
  const h = harness({
    askEngine: async () => {
      throw new Error('upstream 503');
    },
  });
  await handleScanPost(post('daralanaqa.sa'), h.deps);
  await h.flush();

  const again = await handleScanPost(post('daralanaqa.sa', '198.51.100.9'), h.deps);
  assert.equal(again.status, 202);
});

// ── حدّ الزائر ───────────────────────────────────────────────

test('الزائر الواحد ثلاثة فحوص في اليوم', async () => {
  const h = harness();

  for (const domain of ['a.sa', 'b.sa', 'c.sa']) {
    const res = await handleScanPost(post(domain), h.deps);
    assert.equal(res.status, 202, domain);
  }

  const fourth = await handleScanPost(post('d.sa'), h.deps);
  assert.equal(fourth.status, 429);
  assert.equal(h.started(), 3);
});

test('ترويسة عنوانٍ فارغة لا تجعل الكلّ زائراً واحداً', async () => {
  // `''` ليست عنواناً. بـ`??` كانت تُقبل كما هي، فيتقاسم كلُّ من وصل بترويسةٍ
  // فارغة رصيداً واحداً: الرابع منهم يُرفض وهو لم يفحص شيئاً. بـ`||` يسقط
  // الفارغ إلى `x-real-ip`، فلكلٍّ رصيده.
  const h = harness();

  for (const [i, realIp] of ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'].entries()) {
    const req = new Request('https://aitchek.online/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '', 'x-real-ip': realIp },
      body: JSON.stringify({ url: `store-${i}.sa` }),
    });
    assert.equal((await handleScanPost(req, h.deps)).status, 202, realIp);
  }
});
