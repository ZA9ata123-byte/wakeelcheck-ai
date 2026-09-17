import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, FetchResult } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import { PLANS, runScan, type PipelineDeps, type SecurityCollected } from '../src/pipeline.ts';

/**
 * مسارُ المحرّكات: متوازٍ بين المحرّكات، متسلسلٌ داخل كلّ محرّك.
 *
 * كان كلُّ شيء متسلسلاً — أربعون نداءً ثمّ أربعون استخراجاً في طلبٍ واحد.
 * هذه الاختبارات تحرس الشكل الجديد بثلاثة شروط لا يُفرَّط في أيٍّ منها:
 * أن تجري المحرّكات معاً، وألّا يزيد المزوّد الواحد على نداءٍ واحد في
 * الطريق، وألّا يتغيّر ترتيبُ النتيجة بتغيّر سرعة الشبكة.
 */

const NOW = new Date('2026-09-17T00:00:00Z');

const HOME = `<!doctype html><html lang="ar-SA"><head>
<title>دار الأناقة</title></head><body><h1>دار الأناقة</h1>
<a href="/products/abaya-1">عباية</a></body></html>`;

const ANSWER = 'من أبرز الخيارات بيت العباية — تصاميم راقية.';

const SECURITY: SecurityCollected = {
  domainInfo: { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000).toISOString() },
  cert: { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000).toISOString(), protocol: 'TLSv1.3' },
  mail: { spf: 'v=spf1 ~all', dmarc: 'v=DMARC1; p=none' },
  jsAssets: [],
  danglingCnames: [],
};

function page(html: string, url: string): FetchResult {
  return { status: 200, headers: {}, body: html, ttfbMs: 10, finalUrl: url, redirects: 0 };
}

// ثمانيةُ أحرفٍ فأكثر: `generateQuestions` تُسقط ما دون ذلك.
const QUESTIONS = Array.from({ length: 4 }, (_, i) => ({
  text: `وش أفضل متجر عبايات رقم ${i + 1}؟`,
  intent: 'discovery' as const,
}));

/** يراقب التزامن: كم نداءً في الطريق، إجمالاً ولكلّ محرّك. */
function tracker() {
  const live = new Map<Engine, number>();
  let inFlight = 0;
  const peak = { all: 0, perEngine: 0 };

  return {
    peak,
    enter(engine: Engine): void {
      inFlight += 1;
      const mine = (live.get(engine) ?? 0) + 1;
      live.set(engine, mine);
      peak.all = Math.max(peak.all, inFlight);
      peak.perEngine = Math.max(peak.perEngine, mine);
    },
    leave(engine: Engine): void {
      inFlight -= 1;
      live.set(engine, (live.get(engine) ?? 1) - 1);
    },
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    async fetchPage(url) {
      return page(HOME, url.includes('/products/') ? url : 'https://daralanaqa.sa/');
    },
    async fetchText() {
      return null;
    },
    async askEngine() {
      return { text: ANSWER, citedUrls: [], costMicros: 1000 };
    },
    async collectSecurity() {
      return SECURITY;
    },
    llm: fakeProvider({
      scripts: [
        { match: /النطاق:/, reply: '{"category":"عبايات","city":"الرياض","brandName":"دار الأناقة"}' },
        { match: /العدد المطلوب/, reply: JSON.stringify({ questions: QUESTIONS }) },
      ],
      fallbackReply: '{"competitors":[{"name":"بيت العباية","domain":null}]}',
    }),
    now: () => NOW,
    newId: () => 'scan-1',
    ...over,
  };
}

// ── شكل التزامن ──────────────────────────────────────────────

test('المحرّكات تجري معاً، والمزوّد الواحد نداءٌ واحد في الطريق', async () => {
  const t = tracker();

  await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine(engine) {
        t.enter(engine);
        await wait(12);
        t.leave(engine);
        return { text: ANSWER, citedUrls: [], costMicros: 1000 };
      },
    })
  );

  assert.equal(
    t.peak.all,
    PLANS.full.engines.length,
    'كل المحرّكات يجب أن تكون في الطريق معاً'
  );
  assert.equal(t.peak.perEngine, 1, 'مزوّدٌ واحد لا يُنادى مرّتين في آنٍ — حدُّ المعدّل والميزانية');
});

test('الزمن يقارب أبطأ مسار لا مجموع النداءات', async () => {
  const perCall = 10;
  const started = Date.now();

  await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine() {
        await wait(perCall);
        return { text: ANSWER, citedUrls: [], costMicros: 0 };
      },
    })
  );

  const spent = Date.now() - started;
  const sequential = QUESTIONS.length * PLANS.full.engines.length * perCall;
  const oneLane = QUESTIONS.length * perCall;

  // المتسلسل 160ms والمسار الواحد 40ms. الحدُّ سخيٌّ عمداً حتى لا يتذبذب
  // الاختبار على آلةٍ مشغولة، ويبقى قاطعاً في التفريق بين الشكلين.
  assert.ok(
    spent < sequential / 2,
    `توقّعنا ما يقارب ${oneLane}ms لا ${sequential}ms — وجدنا ${spent}ms`
  );
});

// ── الحتمية ──────────────────────────────────────────────────

test('الترتيب لا يتغيّر بتغيّر سرعة المحرّكات', async () => {
  // المحرّك الأخير أسرع بكثير: لو رُتّبت الإجابات بترتيب الوصول لتصدّر.
  const speed: Record<string, number> = {
    chatgpt: 30,
    ai_overviews: 20,
    ai_mode: 10,
    perplexity: 1,
  };

  const { result } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine(engine) {
        await wait(speed[engine] ?? 1);
        return { text: ANSWER, citedUrls: [], costMicros: 0 };
      },
    })
  );

  const expected = result.questions.flatMap((q) =>
    PLANS.full.engines.map((e) => `${q.id}/${e}`)
  );

  assert.deepEqual(
    result.answers.map((a) => `${a.questionId}/${a.engine}`),
    expected,
    'السؤال ثمّ المحرّك — كترتيب الخطّة، لا كترتيب الوصول'
  );
});

test('التحذيرات مرتّبة كذلك — لا بترتيب الإخفاق', async () => {
  const { warnings } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine(engine) {
        // الأسرع يُخفق أولاً زمنياً، ويجب أن يظهر أخيراً في القائمة.
        await wait(engine === 'perplexity' ? 1 : 25);
        throw new Error(`${engine} سقط`);
      },
    })
  );

  const engineWarnings = warnings.filter((w) => w.includes('سقط'));
  assert.equal(engineWarnings.length, QUESTIONS.length * PLANS.full.engines.length);
  assert.ok(engineWarnings[0]?.startsWith('chatgpt/'), `أول تحذير: ${engineWarnings[0]}`);
});

// ── العزل ────────────────────────────────────────────────────

test('محرّكٌ يسقط تماماً لا يمسّ مسارات غيره', async () => {
  const { result, warnings } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine(engine) {
        if (engine === 'ai_mode') throw new Error('مزوّد معطّل');
        return { text: ANSWER, citedUrls: [], costMicros: 500 };
      },
    })
  );

  assert.equal(result.status, 'done');
  assert.equal(
    result.answers.length,
    QUESTIONS.length * (PLANS.full.engines.length - 1),
    'ثلاثة مسارات كاملة رغم سقوط الرابع'
  );
  assert.ok(!result.answers.some((a) => a.engine === 'ai_mode'));
  assert.ok(warnings.some((w) => w.includes('مزوّد معطّل')));

  // والقاعدة 06: عمودٌ لم يعد منه شيء «لم يُقَس» لا «غائب».
  const row = result.shareOfVoice.byEngine.find((r) => r.engine === 'ai_mode');
  assert.equal(row?.coverage, 'not_measured');
  assert.equal(row?.answers, 0);
});

// ── الكلفة ───────────────────────────────────────────────────

test('كلفة الاستخراج تُحسب — لا تُبتلع', async () => {
  // نداءُ المحرّك بصفر، فكلُّ ما يظهر هو كلفة النموذج: التوصيف والأسئلة
  // والاستخراج. لو ابتُلع الاستخراج لسقط هذا إلى كلفة خطوتين فقط.
  const { result, costMicros } = await runScan(
    { url: 'daralanaqa.sa', kind: 'full' },
    deps({
      async askEngine() {
        return { text: ANSWER, citedUrls: [], costMicros: 0 };
      },
      llm: fakeProvider({
        scripts: [
          { match: /النطاق:/, reply: '{"category":"عبايات","city":null,"brandName":null}' },
          { match: /العدد المطلوب/, reply: JSON.stringify({ questions: QUESTIONS }) },
        ],
        fallbackReply: '{"competitors":[{"name":"بيت العباية","domain":null}]}',
        costMicrosPerCall: 100,
      }),
    })
  );

  const extractions = result.answers.length;
  assert.equal(extractions, QUESTIONS.length * PLANS.full.engines.length);

  // توصيف + أسئلة + استخراجٌ لكلّ إجابة.
  assert.equal(costMicros, (2 + extractions) * 100);
  assert.ok(result.answers.every((a) => a.costMicros === 100), 'كلّ إجابة تحمل كلفتها');
});
