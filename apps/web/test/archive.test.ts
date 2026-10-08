import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScanResult } from '@wakeelcheck/core';
import type { ArchiveEntry, ScanArchive } from '@wakeelcheck/db';
import { checkBudget, memoryStore, type KeyValueStore } from '@wakeelcheck/limits';
import { launchScan, shouldArchive } from '../lib/launch';
import { readReport, saveResult } from '../lib/store';
import { NOW, pipelineDeps } from './fixture';

/**
 * #5 من جهة الموقع: ما يُؤرشف، ومن أين يُقرأ.
 *
 * الـSQL نفسه يُختبر على Postgres حقيقيّ في `packages/db`. هنا الأرشيف
 * وهميّ، والمُختبَر قرارُ الموقع: متى يُكتب، وأنّ سقوطه لا يمسّ غيره.
 */

function memoryArchive(opts: { broken?: boolean } = {}): ScanArchive & { saved: ArchiveEntry[] } {
  const saved: ArchiveEntry[] = [];
  return {
    saved,
    async save(entry) {
      if (opts.broken === true) throw new Error('archive down');
      saved.push(entry);
    },
    async get(id) {
      return saved.find((e) => e.result.id === id)?.result ?? null;
    },
    async history() {
      return saved.map((e) => e.result);
    },
  };
}

const input = {
  url: 'daralanaqa.sa',
  domain: 'daralanaqa.sa',
  kind: 'quick' as const,
  scanId: 'scan-a',
  budgetMs: 30_000,
  cacheTtlHours: 24,
};

// ── ما يُؤرشف ────────────────────────────────────────────────

test('التقرير المكتمل الحقيقيّ يُؤرشف بنطاقه وكلفته ووقته', async () => {
  const archive = memoryArchive();
  await launchScan(input, {
    deps: pipelineDeps({ engineMicros: 21_700 }),
    demo: false,
    store: memoryStore(),
    put: () => {},
    archive,
  });

  assert.equal(archive.saved.length, 1);
  const [entry] = archive.saved;
  assert.equal(entry?.domain, 'daralanaqa.sa');
  assert.equal(entry?.result.id, 'scan-a');
  assert.equal(entry?.result.status, 'done');
  assert.equal(entry?.costMicros, 2 * 21_700);
  assert.equal(entry?.at.toISOString(), NOW.toISOString(), 'من الساعة المحقونة');
});

test('ما يُؤرشف وما لا يُؤرشف', () => {
  const base = { status: 'done', answers: [] } as unknown as ScanResult;

  assert.equal(shouldArchive(base, false), true, 'مكتملٌ بلا إجابة: جاهزيته وأمنه حقيقيان');
  assert.equal(shouldArchive(base, true), false, 'الوهميّ لا يبقى');
  assert.equal(shouldArchive({ ...base, status: 'failed' }, false), false, 'الفاشل لا يبقى');
  assert.equal(shouldArchive({ ...base, status: 'running' }, false), false, 'الجاري لا يبقى');
});

test('الوضع التجريبي لا يكتب في الأرشيف', async () => {
  const archive = memoryArchive();
  await launchScan(input, { deps: pipelineDeps(), demo: true, store: memoryStore(), put: () => {}, archive });

  assert.equal(archive.saved.length, 0);
});

test('بلا أرشيف: لا شيء ينكسر', async () => {
  const saved = new Map<string, ScanResult>();
  await launchScan(input, {
    deps: pipelineDeps(),
    demo: false,
    store: memoryStore(),
    put: (r) => {
      saved.set(r.id, r);
    },
    archive: null,
  });

  assert.equal(saved.get('scan-a')?.status, 'done');
});

// ── الاستقلال: سقوطُ واحدٍ لا يمسّ غيره ──────────────────────

test('أرشيفٌ ساقط لا يمنع تسجيل الإنفاق ولا الكاش', async () => {
  const store = memoryStore();
  await launchScan(input, {
    deps: pipelineDeps({ engineMicros: 21_700 }),
    demo: false,
    store,
    put: () => {},
    archive: memoryArchive({ broken: true }),
  });

  assert.equal((await checkBudget(store, 20, NOW)).spentMicros, 2 * 21_700, 'الإنفاق سُجّل');
  assert.equal(await store.get('scan:quick:daralanaqa.sa'), 'scan-a', 'والكاش كُتب');
});

test('مخزنٌ يسقط عند الإنفاق لا يمنع الأرشفة', async () => {
  // كان الدفتر كلّه في محاولةٍ واحدة: سقوطُ أوّل خطوة يُسقط ما بعدها.
  const broken: KeyValueStore = {
    ...memoryStore(),
    incrBy: async () => {
      throw new Error('redis down');
    },
  };
  const archive = memoryArchive();

  await launchScan(input, { deps: pipelineDeps(), demo: false, store: broken, put: () => {}, archive });

  assert.equal(archive.saved.length, 1, 'التقرير أُرشف رغم سقوط الدفتر');
});

// ── القراءة ──────────────────────────────────────────────────

const report = (id: string, status: ScanResult['status'] = 'done'): ScanResult => ({
  id,
  kind: 'quick',
  status,
  profile: null,
  questions: [],
  answers: [],
  security: [],
  rules: [],
  shareOfVoice: { store: 0, top: null, total: 0, byEngine: [] },
});

test('المخزن أولاً — فيه الحالة الأحدث', async () => {
  // فحصٌ جارٍ في المخزن ونسخةٌ قديمة في الأرشيف: الجاري هو الحقيقة.
  const store = memoryStore();
  await saveResult(store, report('r1', 'running'));
  const archive = memoryArchive();
  await archive.save({ domain: 'x.sa', result: report('r1', 'done'), costMicros: 0, at: NOW });

  assert.equal((await readReport(store, archive, 'r1'))?.status, 'running');
});

test('رابطٌ انتهى عمره في المخزن يُقرأ من الأرشيف', async () => {
  // هذا سبب #5: رابطٌ أُرسل إلى شريكٍ وفُتح بعد أسبوع.
  const archive = memoryArchive();
  await archive.save({ domain: 'x.sa', result: report('old'), costMicros: 0, at: NOW });

  assert.equal((await readReport(memoryStore(), archive, 'old'))?.id, 'old');
});

test('لا هنا ولا هناك: null', async () => {
  assert.equal(await readReport(memoryStore(), memoryArchive(), 'none'), null);
  assert.equal(await readReport(memoryStore(), null, 'none'), null, 'وبلا أرشيف');
});
