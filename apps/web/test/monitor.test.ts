import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuyingQuestion, Digest, ScanKind, ScanResult } from '@wakeelcheck/core';
import type { ArchiveEntry, Monitor, MonitorRegistry, ScanArchive } from '@wakeelcheck/db';
import { checkBudget, memoryStore } from '@wakeelcheck/limits';
import { runScan } from '@wakeelcheck/pipeline';
import { runMonitor, type MonitorDeps } from '../lib/monitor';
import { loadResult } from '../lib/store';
import { NOW, pipelineDeps, type FixtureOptions } from './fixture';

/**
 * قياس المتابعة من طرفه إلى طرفه — خطّ الأنابيب الحقيقيّ بتبعياتٍ وهمية.
 *
 * الـSQL يُختبر على Postgres في `packages/db`. هنا قرارات التشغيل: من أين
 * الأسئلة، وبمَ يُقارَن، وأنّ لا شيء يُرمى من مهمّةٍ لا يراها أحد.
 */

// ── سجلّ وأرشيف في الذاكرة ───────────────────────────────────

function memoryArchive(): ScanArchive & { saved: ArchiveEntry[] } {
  const saved: ArchiveEntry[] = [];
  return {
    saved,
    async save(entry) {
      saved.push(entry);
    },
    async get(id) {
      return saved.find((e) => e.result.id === id)?.result ?? null;
    },
    async history(domain: string, kind: ScanKind, limit: number) {
      return saved
        .filter((e) => e.domain === domain && e.result.kind === kind && e.result.status === 'done')
        .reverse()
        .slice(0, limit)
        .map((e) => e.result);
    },
  };
}

interface Recorded {
  runs: { domain: string; at: Date; reportId: string }[];
  digests: Map<string, Digest>;
  questions: BuyingQuestion[] | null;
}

function memoryRegistry(opts: { brokenDigest?: boolean } = {}): MonitorRegistry & Recorded {
  const self: MonitorRegistry & Recorded = {
    runs: [],
    digests: new Map(),
    questions: null,
    async enroll() {},
    async deactivate() {},
    async get() {
      return null;
    },
    async due() {
      return [];
    },
    async setQuestions(_domain, questions) {
      self.questions ??= [...questions];
      return self.questions;
    },
    async markRun(domain, at, reportId) {
      self.runs.push({ domain, at, reportId });
    },
    async saveDigest({ reportId, digest }) {
      if (opts.brokenDigest === true) throw new Error('db down');
      self.digests.set(reportId, digest);
    },
    async digestFor(reportId) {
      return self.digests.get(reportId) ?? null;
    },
  };
  return self;
}

const monitor = (questions: BuyingQuestion[] | null = null): Monitor => ({
  domain: 'daralanaqa.sa',
  url: 'https://daralanaqa.sa/',
  locale: 'ar',
  questions,
  active: true,
  createdAt: NOW,
  lastRunAt: null,
  lastReport: null,
});

let ids = 0;
function deps(
  registry: MonitorRegistry,
  archive: ScanArchive,
  opts: FixtureOptions & Partial<Pick<MonitorDeps, 'run' | 'store'>> = {}
): MonitorDeps {
  return {
    registry,
    archive,
    store: opts.store ?? memoryStore(),
    pipeline: pipelineDeps(opts),
    ...(opts.run === undefined ? {} : { run: opts.run }),
    budgetMs: 30_000,
    now: () => NOW,
    newId: () => `m-${++ids}`,
  };
}

const MENTIONED = 'أنصح بمتجر دار الأناقة — تشكيلة عبايات واسعة.';

const FREE_QUESTIONS: BuyingQuestion[] = [
  { id: 'q1', text: 'وين ألقى عبايات سوداء ناعمة بالرياض؟', intent: 'discovery' },
  { id: 'q2', text: 'أفضل متجر عبايات يوصل نفس اليوم؟', intent: 'comparison' },
];

const freeReport = (questions: BuyingQuestion[]): ScanResult => ({
  id: 'free-1',
  kind: 'quick',
  status: 'done',
  profile: null,
  questions,
  answers: [],
  security: [],
  rules: [],
  shareOfVoice: { store: 0, top: null, total: 0, byEngine: [] },
});

// ── الأسئلة ──────────────────────────────────────────────────

test('أوّل قياس يسأل أسئلة التقرير المجاني — ما رآه التاجر بعينه', async () => {
  const archive = memoryArchive();
  await archive.save({ domain: 'daralanaqa.sa', result: freeReport(FREE_QUESTIONS), costMicros: 0, at: NOW });
  const registry = memoryRegistry();

  const out = await runMonitor(monitor(), deps(registry, archive));

  assert.equal(out.status, 'measured');
  const measured = archive.saved.at(-1)?.result;
  assert.deepEqual(measured?.questions.map((q) => q.text), FREE_QUESTIONS.map((q) => q.text));
  assert.deepEqual(registry.questions?.map((q) => q.text), FREE_QUESTIONS.map((q) => q.text), 'وتُثبَّت');
});

test('بلا تقريرٍ مجاني: تُولَّد مرّةً وتُثبَّت', async () => {
  const archive = memoryArchive();
  const registry = memoryRegistry();

  const out = await runMonitor(monitor(), deps(registry, archive));

  assert.equal(out.status, 'measured');
  assert.ok((registry.questions?.length ?? 0) > 0, 'الأسئلة المولَّدة حُفظت');
  assert.deepEqual(registry.questions, archive.saved.at(-1)?.result.questions);
});

test('الأسئلة المحفوظة تغلب التقرير المجاني', async () => {
  // التاجر فحص مجاناً من جديد بعد الاشتراك: أسئلة المتابعة لا تتبدّل لذلك.
  const archive = memoryArchive();
  await archive.save({ domain: 'daralanaqa.sa', result: freeReport(FREE_QUESTIONS), costMicros: 0, at: NOW });
  const saved: BuyingQuestion[] = [{ id: 'q1', text: 'عبايات رسمية للدوام بسعر معقول؟', intent: 'price' }];
  const registry = memoryRegistry();

  await runMonitor(monitor(saved), deps(registry, archive));

  assert.deepEqual(archive.saved.at(-1)?.result.questions.map((q) => q.text), [saved[0]?.text]);
  assert.equal(registry.questions, null, 'ولا يُكتب فوقها');
});

// ── النشرة ───────────────────────────────────────────────────

test('أوّل قياس: نشرة بداية، لا «لا تغيّر»', async () => {
  const registry = memoryRegistry();
  const out = await runMonitor(monitor(), deps(registry, memoryArchive()));

  assert.equal(out.status === 'measured' && out.digest.tone, 'baseline');
});

test('الأسبوع الثاني يُقارَن بالأوّل — لا بنفسه', async () => {
  // يُقرأ الماضي قبل حفظ الحاضر. لو قُرئ بعده لقورن القياس بنفسه فقيل
  // «لا تغيّر» عن متجرٍ اختفى.
  const archive = memoryArchive();
  const registry = memoryRegistry();

  await runMonitor(
    monitor(),
    deps(registry, archive, { askEngine: async () => ({ text: MENTIONED, citedUrls: [], costMicros: 0 }) })
  );
  const second = await runMonitor(monitor(registry.questions), deps(registry, archive));

  assert.equal(second.status, 'measured');
  if (second.status !== 'measured') return;
  assert.equal(second.digest.tone, 'alert');
  assert.match(second.digest.headline.ar, /اختفى/);
});

test('النشرة تُحفظ، والتقرير بنشرته في المخزن فوراً', async () => {
  const store = memoryStore();
  const registry = memoryRegistry();

  const out = await runMonitor(monitor(), deps(registry, memoryArchive(), { store }));

  assert.equal(out.status, 'measured');
  assert.equal(registry.digests.get(out.reportId)?.tone, 'baseline');
  const cached = await loadResult(store, out.reportId);
  assert.equal(cached?.digest?.tone, 'baseline', 'رابط التقرير يعمل قبل أن يُقرأ من الأرشيف');
  assert.deepEqual(registry.runs.map((r) => r.reportId), [out.reportId]);
});

test('القياس يُؤرشف بنوعه، فيُقارَن به الأسبوع القادم', async () => {
  const archive = memoryArchive();
  const out = await runMonitor(monitor(), deps(memoryRegistry(), archive));

  const [entry] = archive.saved;
  assert.equal(entry?.result.id, out.reportId);
  assert.equal(entry?.result.kind, 'monitor');
  assert.equal(entry?.domain, 'daralanaqa.sa');
});

// ── المال ────────────────────────────────────────────────────

test('ما تصرفه المتابعة يُحسب على السقف الشهري', async () => {
  const store = memoryStore();
  await runMonitor(monitor(), deps(memoryRegistry(), memoryArchive(), { store, engineMicros: 10_000 }));

  assert.ok((await checkBudget(store, 20, NOW)).spentMicros >= 10_000);
});

test('وما صُرف على قياسٍ فشل يُحسب كذلك', async () => {
  const store = memoryStore();
  const registry = memoryRegistry();
  const out = await runMonitor(
    monitor(),
    deps(registry, memoryArchive(), {
      store,
      run: async (req, d) => {
        const real = await runScan(req, d);
        return { ...real, costMicros: 5_000, result: { ...real.result, status: 'failed', error: 'x' } };
      },
    })
  );

  assert.equal(out.status, 'failed');
  assert.equal((await checkBudget(store, 20, NOW)).spentMicros, 5_000);
});

// ── لا يُرمى ─────────────────────────────────────────────────

test('فحصٌ يرمي: نتيجة فاشلة، والقياس مُسجَّل فلا يحجب من بعده', async () => {
  const registry = memoryRegistry();
  const out = await runMonitor(
    monitor(),
    deps(registry, memoryArchive(), {
      run: async () => {
        throw new Error('boom');
      },
    })
  );

  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' && out.error, 'boom');
  assert.equal(registry.runs.length, 1, 'وإلّا بقي أوّل المستحقّين إلى الأبد');
  assert.equal(registry.questions, null, 'ولا تُثبَّت أسئلةٌ لم تُسأل');
});

test('صفحةٌ لا تُجلب: فاشل، مُسجَّل، ولا أرشيف', async () => {
  const registry = memoryRegistry();
  const archive = memoryArchive();
  const out = await runMonitor(
    monitor(),
    deps(registry, archive, {
      fetchPage: async () => {
        throw new Error('unreachable');
      },
    })
  );

  assert.equal(out.status, 'failed');
  assert.equal(registry.runs.length, 1);
  assert.equal(archive.saved.length, 0, 'الفاشل لا يُقارَن به الأسبوع القادم');
});

test('قاعدةٌ تسقط عند حفظ النشرة: فاشل لا رمية', async () => {
  const registry = memoryRegistry({ brokenDigest: true });
  const out = await runMonitor(monitor(), deps(registry, memoryArchive()));

  assert.equal(out.status, 'failed');
  assert.equal(registry.runs.length, 1);
});
