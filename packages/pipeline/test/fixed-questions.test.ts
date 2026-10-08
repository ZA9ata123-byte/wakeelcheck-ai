import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuyingQuestion, FetchResult } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import { runScan, type PipelineDeps, type SecurityCollected } from '../src/pipeline.ts';

/**
 * أسئلة المتابعة ثابتة.
 *
 * إجابتا أسبوعين على سؤالين مختلفين لا تُقارَنان. فالمتابعة تحفظ أسئلتها
 * مرّة وتمرّرها كلّ أسبوع، ويجب أن تُسأل هي نفسها — لا أن تُستبدل بمولَّدة.
 */

const NOW = new Date('2026-10-08T00:00:00Z');

const SECURITY: SecurityCollected = {
  domainInfo: { expiresAt: null },
  cert: { expiresAt: null, protocol: null },
  mail: { spf: null, dmarc: null },
  jsAssets: [],
  danglingCnames: [],
};

const page = (url: string): FetchResult => ({
  status: 200,
  headers: {},
  body: '<html><head><title>دار الأناقة</title></head><body><h1>دار الأناقة</h1></body></html>',
  ttfbMs: 5,
  // الجالب الحقيقيّ يُرجع رابطاً كاملاً بعد التطبيع.
  finalUrl: url.startsWith('http') ? url : `https://${url}/`,
  redirects: 0,
});

const FIXED: BuyingQuestion[] = [
  { id: 'm1', text: 'وش أفضل متجر عبايات في الرياض؟', intent: 'discovery' },
  { id: 'm2', text: 'عبايات بأقل من 300 ريال مع توصيل؟', intent: 'price' },
];

function deps(asked: string[]): { deps: PipelineDeps; llm: ReturnType<typeof fakeProvider> } {
  const llm = fakeProvider({
    scripts: [
      { match: /النطاق:/, reply: '{"category":"عبايات","city":"الرياض","brandName":null}' },
      {
        match: /العدد المطلوب/,
        reply: JSON.stringify({ questions: [{ text: 'سؤالٌ مولَّد لم يُطلب أبداً؟', intent: 'discovery' }] }),
      },
    ],
    fallbackReply: '{"competitors":[]}',
    costMicrosPerCall: 100,
  });

  return {
    llm,
    deps: {
      fetchPage: async (url) => page(url),
      fetchText: async () => null,
      askEngine: async (_engine, question) => {
        asked.push(question);
        return { text: 'من أبرز الخيارات بيت الأناقة.', citedUrls: [], costMicros: 0 };
      },
      collectSecurity: async () => SECURITY,
      llm,
      now: () => NOW,
      newId: () => 'scan-1',
    },
  };
}

test('الأسئلة الثابتة تُسأل هي نفسها، بمعرّفاتها', async () => {
  const asked: string[] = [];
  const { result } = await runScan({ url: 'daralanaqa.sa', kind: 'quick', questions: FIXED }, deps(asked).deps);

  assert.deepEqual(result.questions, FIXED);
  assert.deepEqual(asked, FIXED.map((q) => q.text));
  assert.deepEqual([...new Set(result.answers.map((a) => a.questionId))], ['m1', 'm2']);
});

test('الأسئلة الثابتة لا تكلّف نداء توليد', async () => {
  const { deps: d, llm } = deps([]);
  await runScan({ url: 'daralanaqa.sa', kind: 'quick', questions: FIXED }, d);

  assert.ok(
    !llm.calls.some((c) => c.user.includes('العدد المطلوب')),
    'لم يُطلب من النموذج توليد أسئلة'
  );
});

test('بلا أسئلةٍ ثابتة يُولَّد كما كان', async () => {
  const asked: string[] = [];
  await runScan({ url: 'daralanaqa.sa', kind: 'quick' }, deps(asked).deps);

  assert.deepEqual(asked, ['سؤالٌ مولَّد لم يُطلب أبداً؟']);
});

test('قائمةٌ فارغة كغيابها — لا فحص بلا أسئلة', async () => {
  const asked: string[] = [];
  await runScan({ url: 'daralanaqa.sa', kind: 'quick', questions: [] }, deps(asked).deps);

  assert.equal(asked.length, 1, 'وُلّد بدل أن يُفحص بلا سؤال');
});

test('الأسئلة الممرَّرة لا تُعدَّل', async () => {
  // تُحفظ في سجلّ المتابعة. تعديلها هنا يُفسد سؤال الأسبوع القادم.
  const frozen = FIXED.map((q) => Object.freeze({ ...q }));
  await assert.doesNotReject(
    runScan({ url: 'daralanaqa.sa', kind: 'quick', questions: frozen }, deps([]).deps)
  );
});
