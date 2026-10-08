import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScanResult } from '@wakeelcheck/core';
import { memoryStore, type KeyValueStore } from '@wakeelcheck/limits';
import {
  HARD_DEADLINE_MS,
  PLATFORM_LIMIT_MS,
  SOFT_BUDGET_MS,
  launchScan,
  shouldCache,
  withDeadline,
  withHardDeadline,
} from '../lib/launch';
import { NOW, pipelineDeps } from './fixture';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── السقوف الزمنية ───────────────────────────────────────────

test('اللَّيِّن قبل الصُّلب قبل المنصّة', () => {
  assert.ok(SOFT_BUDGET_MS < HARD_DEADLINE_MS, 'لا بدء بعد اللّيّن، ولا انتظار بعد الصّلب');
  assert.ok(HARD_DEADLINE_MS < PLATFORM_LIMIT_MS, 'وبين الصّلب والمنصّة هامشٌ للأمان والتخزين');
  // جمع الأمان يجري بالتوازي وأطول مهله ثماني ثوانٍ.
  assert.ok(PLATFORM_LIMIT_MS - HARD_DEADLINE_MS >= 10_000, 'الهامش يسع جمع الأمان');
});

test('maxDuration في المسار يطابق سقف المنصّة', () => {
  // Next يقرؤه نصّاً ثابتاً فلا يُستورد. التكرار مضطرّ، وهذا يحرس التطابق.
  const candidates = [
    resolve(process.cwd(), 'apps/web/app/api/scan/route.ts'),
    resolve(process.cwd(), 'app/api/scan/route.ts'),
  ];
  const path = candidates.find((p) => existsSync(p));
  assert.ok(path, 'لم يُعثر على ملف المسار');

  const match = /export const maxDuration = (\d+);/.exec(readFileSync(path, 'utf8'));
  assert.ok(match, 'maxDuration غير مُعلَن في المسار');
  assert.equal(Number(match[1]) * 1000, PLATFORM_LIMIT_MS);
});

// ── المهلة ───────────────────────────────────────────────────

test('النداء الأسرع من المهلة يمرّ كما هو', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 50, 'x'), 'ok');
});

test('النداء الأبطأ من المهلة يُترك', async () => {
  await assert.rejects(withDeadline(wait(200).then(() => 'late'), 20, 'chatgpt'), /chatgpt/);
});

test('مهلةٌ منقضية لا تنتظر شيئاً', async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 0, 'llm'), /deadline passed/);
});

test('الخطأ الأصليّ يمرّ كما هو لا كمهلة', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('HTTP 429')), 100, 'x'), /HTTP 429/);
});

test('المهلة الصلبة تشمل المحرّك والنموذج معاً', async () => {
  // ساعةٌ قفزت ستّين ثانية: كل نداءٍ بعدها يُرفض فوراً، لا ينتظر.
  let t = NOW.getTime();
  const base = pipelineDeps();
  const deps = withHardDeadline({ ...base, now: () => new Date(t) }, HARD_DEADLINE_MS);
  t += 60_000;

  await assert.rejects(deps.askEngine('chatgpt', 'سؤال', 'ar-SA'), /deadline passed/);
  await assert.rejects(deps.llm.complete({ system: 's', user: 'u' }), /deadline passed/);
});

test('المهلة الصلبة لا تمسّ ما قبلها', async () => {
  const deps = withHardDeadline(pipelineDeps(), HARD_DEADLINE_MS);
  const reply = await deps.askEngine('chatgpt', 'سؤال', 'ar-SA');

  assert.ok(reply.text.length > 0);
});

// ── الحفظ ────────────────────────────────────────────────────

function result(over: Partial<ScanResult> = {}): ScanResult {
  return {
    id: 's',
    kind: 'quick',
    status: 'done',
    profile: null,
    questions: [],
    answers: [
      {
        questionId: 'q1',
        engine: 'chatgpt',
        answerText: 'نص',
        citedUrls: [],
        storeMentioned: false,
        competitors: [],
        capturedAt: NOW.toISOString(),
        costMicros: 0,
      },
    ],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 1, byEngine: [] },
    ...over,
  };
}

test('ما يُحفظ وما لا يُحفظ', () => {
  assert.equal(shouldCache(result(), false), true, 'مكتمل وله إجابة');
  assert.equal(shouldCache(result(), true), false, 'الوهميّ');
  assert.equal(shouldCache(result({ status: 'failed' }), false), false, 'الفاشل');
  assert.equal(shouldCache(result({ answers: [] }), false), false, 'بلا إجابة');
});

// ── التسوية ──────────────────────────────────────────────────

test('الوعد لا يُرفض حتى حين يسقط الفحص', async () => {
  // يُمرَّر إلى `after()`، ورفضٌ هناك لا يراه أحد. فالفشل يُخزَّن ولا يُرمى.
  const saved = new Map<string, ScanResult>();

  await launchScan(
    { url: 'x.sa', domain: 'x.sa', kind: 'quick', scanId: 'scan-x', budgetMs: 1000, cacheTtlHours: 24 },
    {
      deps: pipelineDeps(),
      demo: false,
      store: memoryStore(),
      put: (r) => {
          saved.set(r.id, r);
        },
      run: async () => {
        throw new Error('عطلٌ لم يتوقّعه أحد');
      },
    }
  );

  assert.equal(saved.get('scan-x')?.status, 'failed');
  assert.equal(saved.get('scan-x')?.error, 'عطلٌ لم يتوقّعه أحد');
});

test('سقوطُ الدفتر لا يُفسد ما رآه التاجر', async () => {
  // التخزين يسبق المحاسبة. مخزنٌ يسقط عند الزيادة لا يحوّل النتيجة إلى فشل.
  const broken: KeyValueStore = {
    ...memoryStore(),
    incrBy: async () => {
      throw new Error('redis unavailable');
    },
  };
  const saved = new Map<string, ScanResult>();

  await launchScan(
    { url: 'daralanaqa.sa', domain: 'daralanaqa.sa', kind: 'quick', scanId: 'scan-y', budgetMs: 30_000, cacheTtlHours: 24 },
    { deps: pipelineDeps(), demo: false, store: broken, put: (r) => {
          saved.set(r.id, r);
        } }
  );

  assert.equal(saved.get('scan-y')?.status, 'done');
});

test('السقف اللّيّن يصل إلى الخطّ', async () => {
  // ما يمرّره المسار يجب أن يصل `runScan` — وإلّا صار رقماً في الكود لا يعمل.
  let seen: number | undefined;

  await launchScan(
    { url: 'x.sa', domain: 'x.sa', kind: 'quick', scanId: 'scan-z', budgetMs: SOFT_BUDGET_MS, cacheTtlHours: 24 },
    {
      deps: pipelineDeps(),
      demo: false,
      store: memoryStore(),
      put: () => {},
      run: async (req, deps) => {
        seen = req.budgetMs;
        return { result: result({ id: deps.newId() }), costMicros: 0, warnings: [] };
      },
    }
  );

  assert.equal(seen, SOFT_BUDGET_MS);
});
