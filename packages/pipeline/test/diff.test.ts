import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CompetitorMention,
  Engine,
  EngineAnswer,
  EngineCoverage,
  EngineRow,
  RuleResult,
  ScanResult,
} from '@wakeelcheck/core';
import { diffScans } from '../src/diff.ts';

// ── تجهيزات ──────────────────────────────────────────────────

function mention(name: string, position = 1): CompetitorMention {
  return { name, domain: null, position };
}

function engineRow(
  engine: Engine,
  coverage: EngineCoverage,
  ranked: CompetitorMention[] = []
): EngineRow {
  return {
    engine,
    coverage,
    storeMentions: coverage === 'mentioned' ? 1 : 0,
    answers: coverage === 'not_measured' ? 0 : 1,
    ranked,
  };
}

function rule(key: string, passed: boolean, weight = 5, ar = key): RuleResult {
  return { key, passed, weight, detail: { ar, en: key }, evidence: '' };
}

const Q = 'وش أفضل متجر عبايات في الرياض؟';

/**
 * فحصٌ كما يُبنى الحقيقيّ: سؤالٌ، ثم إجاباتٌ، ثم ملخّص.
 *
 * كان يُبنى من الملخّص وحده بلا إجابات — شيءٌ لا يحدث في الواقع. و`diffScans`
 * صارت تحكم على الإجابات المشتركة لا على الملخّص، فالتجهيزة تُنشئ لكلّ صفٍّ
 * مقيس إجابةً على السؤال `Q`. والنيّة في كلّ اختبارٍ أدناه لم تتغيّر.
 */
function scan(byEngine: EngineRow[], rules: RuleResult[] = [], question = Q): ScanResult {
  const answers: EngineAnswer[] = byEngine
    .filter((r) => r.coverage !== 'not_measured')
    .map((r) => ({
      questionId: 'q1',
      engine: r.engine,
      answerText: '…',
      citedUrls: [],
      storeMentioned: r.coverage === 'mentioned',
      competitors: [...r.ranked],
      capturedAt: '2026-10-08T00:00:00Z',
      costMicros: 0,
    }));

  return {
    id: 'x',
    kind: 'full',
    status: 'done',
    profile: null,
    questions: [{ id: 'q1', text: question, intent: 'discovery' }],
    answers,
    security: [],
    rules,
    shareOfVoice: { store: 0, top: null, total: answers.length, byEngine },
  };
}

// ── الحضور عبر المحرّكات ─────────────────────────────────────

test('اختفاء المتجر من محرّك يُرصد', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'mentioned')]),
    scan([engineRow('chatgpt', 'absent')])
  );

  assert.equal(d.engines[0]?.direction, 'lost');
  assert.equal(d.changed, true);
});

test('ظهوره في محرّك يُرصد كذلك', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'absent')]),
    scan([engineRow('chatgpt', 'mentioned')])
  );

  assert.equal(d.engines[0]?.direction, 'gained');
});

test('الثبات ليس تغيّراً', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'mentioned')]),
    scan([engineRow('chatgpt', 'mentioned')])
  );

  assert.equal(d.engines[0]?.direction, 'unchanged');
  assert.equal(d.changed, false);
});

// ── الخطر: التنبيه الكاذب ────────────────────────────────────

test('محرّك سقط اليوم لا يُقرأ اختفاءً', () => {
  // العطل عندنا لا يُنسب إلى موقعه — القاعدة 06 ممتدّةً إلى الزمن.
  const d = diffScans(
    scan([engineRow('perplexity', 'mentioned')]),
    scan([engineRow('perplexity', 'not_measured')])
  );

  assert.equal(d.engines[0]?.direction, null, 'لا حكم بلا قياسين');
  assert.equal(d.changed, false, 'ولا تنبيه');
  assert.deepEqual(d.comparableEngines, []);
});

test('محرّك سقط الأسبوع الماضي لا يُقرأ ظهوراً', () => {
  const d = diffScans(
    scan([engineRow('ai_mode', 'not_measured')]),
    scan([engineRow('ai_mode', 'mentioned')])
  );

  assert.equal(d.engines[0]?.direction, null);
  assert.equal(d.changed, false);
});

test('السقوط يُعرَض بحاله ولا يُخفى', () => {
  const d = diffScans(
    scan([engineRow('perplexity', 'mentioned')]),
    scan([engineRow('perplexity', 'not_measured')])
  );

  // يُعرَض: التاجر يرى أن السطح لم يُقَس، لا أن شيئاً لم يحدث.
  assert.equal(d.engines[0]?.before, 'mentioned');
  assert.equal(d.engines[0]?.after, 'not_measured');
});

test('محرّك أُضيف بين الفحصين يظهر بلا حكم', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'mentioned')]),
    scan([engineRow('chatgpt', 'mentioned'), engineRow('perplexity', 'absent')])
  );

  const added = d.engines.find((e) => e.engine === 'perplexity');
  assert.equal(added?.before, 'not_measured');
  assert.equal(added?.direction, null, 'لم يكن يُقاس — فلا انحدار');
  assert.equal(d.changed, false);
});

// ── المنافسون ────────────────────────────────────────────────

test('منافس جديد يُرصد', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'absent', [mention('بيت الأناقة')])]),
    scan([engineRow('chatgpt', 'absent', [mention('بيت الأناقة'), mention('لمسة رقي', 2)])])
  );

  assert.deepEqual(
    d.competitors.map((c) => [c.name, c.change]),
    [['لمسة رقي', 'appeared']]
  );
});

test('منافس اختفى يُرصد', () => {
  const d = diffScans(
    scan([engineRow('chatgpt', 'absent', [mention('لمسة رقي')])]),
    scan([engineRow('chatgpt', 'absent', [])])
  );

  assert.deepEqual(
    d.competitors.map((c) => [c.name, c.change]),
    [['لمسة رقي', 'disappeared']]
  );
});

test('اختلاف التهجئة ليس تغيّراً', () => {
  // «بيت الاناقه» و«بيت الأناقة» واحد — وإلّا صار كل أسبوع منافساً جديداً
  // ومنافساً مختفياً في آن.
  const d = diffScans(
    scan([engineRow('chatgpt', 'absent', [mention('بيت الأناقة')])]),
    scan([engineRow('chatgpt', 'absent', [mention('بيت الاناقه')])])
  );

  assert.deepEqual(d.competitors, []);
  assert.equal(d.changed, false);
});

test('سقوط محرّك لا يُقرأ اختفاء منافس', () => {
  // منافس كان في عمودين وبقي في واحد لأن الآخر لم يُقَس — لا خبر هنا.
  const d = diffScans(
    scan([
      engineRow('chatgpt', 'absent', [mention('بيت الأناقة')]),
      engineRow('perplexity', 'absent', [mention('بيت الأناقة')]),
    ]),
    scan([
      engineRow('chatgpt', 'absent', [mention('بيت الأناقة')]),
      engineRow('perplexity', 'not_measured'),
    ])
  );

  assert.deepEqual(d.competitors, [], 'الحساب على المقيس في الفحصين وحده');
  assert.deepEqual(d.comparableEngines, ['chatgpt']);
  assert.equal(d.changed, false);
});

// ── القواعد ──────────────────────────────────────────────────

test('انتكاسة وإصلاح يُرصدان، والنصّ نصّ الحال الآن', () => {
  const d = diffScans(
    scan([], [rule('machine.sitemap', true, 6, 'خريطة الموقع متاحة'), rule('schema.product', false, 10, 'المخطط مفقود')]),
    scan([], [rule('machine.sitemap', false, 6, 'خريطة الموقع مفقودة'), rule('schema.product', true, 10, 'المخطط موجود')])
  );

  assert.deepEqual(
    d.rules.map((r) => [r.ruleKey, r.change, r.detail.ar]),
    [
      ['machine.sitemap', 'regressed', 'خريطة الموقع مفقودة'],
      ['schema.product', 'fixed', 'المخطط موجود'],
    ]
  );
});

test('الانتكاسات أولاً ثم الأثقل وزناً', () => {
  const d = diffScans(
    scan([], [rule('خفيفة', true, 3), rule('ثقيلة', true, 10), rule('مُصلَحة', false, 9)]),
    scan([], [rule('خفيفة', false, 3), rule('ثقيلة', false, 10), rule('مُصلَحة', true, 9)])
  );

  assert.deepEqual(d.rules.map((r) => r.ruleKey), ['ثقيلة', 'خفيفة', 'مُصلَحة']);
});

test('قاعدة أُضيفت بين الفحصين ليست انتكاسة', () => {
  const d = diffScans(scan([], [rule('قديمة', true)]), scan([], [rule('قديمة', true), rule('جديدة', false)]));

  assert.deepEqual(d.rules, []);
  assert.equal(d.changed, false);
});

test('النتيجة الموزونة تُحسب للطرفين', () => {
  const d = diffScans(
    scan([], [rule('a', true, 10), rule('b', false, 10)]),
    scan([], [rule('a', true, 10), rule('b', true, 10)])
  );

  assert.equal(d.scoreBefore, 50);
  assert.equal(d.scoreAfter, 100);
});

// ── الحدود ───────────────────────────────────────────────────

test('فحصان فارغان لا ينكسران ولا يُنبّهان', () => {
  const d = diffScans(scan([]), scan([]));

  assert.deepEqual(d.engines, []);
  assert.deepEqual(d.competitors, []);
  assert.deepEqual(d.rules, []);
  assert.equal(d.changed, false);
});

// ── الشبيه بالشبيه — ما يمنع التنبيه الكاذب الأسبوعيّ ────────

interface Asked {
  id: string;
  text: string;
  engine: Engine;
  mentioned: boolean;
  competitors?: string[];
}

/** فحصٌ بأسئلةٍ وإجاباتٍ صريحة — لاختبار ما سُئل في الفحصين. */
function asked(items: Asked[]): ScanResult {
  const questions = [...new Map(items.map((i) => [i.id, { id: i.id, text: i.text, intent: 'discovery' as const }])).values()];
  const answers: EngineAnswer[] = items.map((i) => ({
    questionId: i.id,
    engine: i.engine,
    answerText: '…',
    citedUrls: [],
    storeMentioned: i.mentioned,
    competitors: (i.competitors ?? []).map((name, n) => mention(name, n + 1)),
    capturedAt: '2026-10-08T00:00:00Z',
    costMicros: 0,
  }));
  const engines = [...new Set(items.map((i) => i.engine))];
  const byEngine: EngineRow[] = engines.map((engine) => {
    const mine = answers.filter((a) => a.engine === engine);
    return engineRow(engine, mine.some((a) => a.storeMentioned) ? 'mentioned' : 'absent');
  });

  return { ...scan(byEngine), questions, answers };
}

test('أسئلةٌ مختلفة لا تُقارَن — ولا خبر', () => {
  // الأسبوع الماضي ذُكر المتجر في سؤال، وهذا الأسبوع لم يُذكر في سؤالٍ آخر.
  // الملخّص يقول «اختفى». والحقيقة: سُئل غيرُ ما سُئل.
  const d = diffScans(
    asked([{ id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: true }]),
    asked([{ id: 'q1', text: 'أرخص عباية مع توصيل؟', engine: 'chatgpt', mentioned: false }])
  );

  assert.equal(d.comparedQuestions, 0);
  assert.equal(d.engines[0]?.direction, null, 'لا حكم بين سؤالين مختلفين');
  assert.equal(d.changed, false);
  // والعرض يبقى حقيقة كلّ فحص كما هي.
  assert.equal(d.engines[0]?.before, 'mentioned');
  assert.equal(d.engines[0]?.after, 'absent');
});

test('السؤال نفسه بمعرّفٍ آخر يُقارَن', () => {
  // المطابقة على النصّ لا على المعرّف: `q3` أسبوعاً هو `q1` أسبوعاً آخر.
  const d = diffScans(
    asked([{ id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: true }]),
    asked([{ id: 'q3', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: false }])
  );

  assert.equal(d.comparedQuestions, 1);
  assert.equal(d.engines[0]?.direction, 'lost');
});

test('ذِكرٌ في سؤالٍ لم يُسأل هذا الأسبوع ليس اختفاءً', () => {
  // التنبيه الكاذب الذي كان سيصل كلّ أسبوع: الملخّص «ذُكر ← لم يُذكر»، لأن
  // السؤال الذي ذُكر فيه لم يُسأل. على المشترك وحده: لم يُذكر ← لم يُذكر.
  const d = diffScans(
    asked([
      { id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: false },
      { id: 'q2', text: 'عبايات فاخرة بالرياض؟', engine: 'chatgpt', mentioned: true },
    ]),
    asked([{ id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: false }])
  );

  assert.equal(d.engines[0]?.before, 'mentioned', 'الملخّص كان سيقول «اختفى»');
  assert.equal(d.engines[0]?.direction, 'unchanged', 'والمشترك يقول: لا تغيّر');
  assert.equal(d.changed, false);
});

test('منافسٌ في سؤالٍ غير مشترك ليس منافساً جديداً', () => {
  const d = diffScans(
    asked([{ id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: false, competitors: ['بيت الأناقة'] }]),
    asked([
      { id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned: false, competitors: ['بيت الأناقة'] },
      { id: 'q2', text: 'سؤالٌ جديد هذا الأسبوع؟', engine: 'chatgpt', mentioned: false, competitors: ['لمسة رقي'] },
    ])
  );

  assert.deepEqual(d.competitors, [], '«لمسة رقي» ظهرت في سؤالٍ لم يُسأل قبلاً');
});

test('النصّ يُطابَق بعد التطبيع — مسافةٌ أو تشكيلٌ لا يصنع سؤالاً آخر', () => {
  const d = diffScans(
    asked([{ id: 'q1', text: 'أفضلُ متجرِ عبايات؟', engine: 'chatgpt', mentioned: true }]),
    asked([{ id: 'q1', text: '  أفضل متجر عبايات؟ ', engine: 'chatgpt', mentioned: true }])
  );

  assert.equal(d.comparedQuestions, 1);
  assert.equal(d.engines[0]?.direction, 'unchanged');
});

test('عدد الأسئلة المشتركة يُحسب مرّةً لكلّ سؤال لا لكلّ محرّك', () => {
  const both = (mentioned: boolean) =>
    asked([
      { id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'chatgpt', mentioned },
      { id: 'q1', text: 'أفضل متجر عبايات؟', engine: 'perplexity', mentioned },
      { id: 'q2', text: 'عباية بأقل من 300؟', engine: 'chatgpt', mentioned },
    ]);

  assert.equal(diffScans(both(true), both(true)).comparedQuestions, 2);
});

test('القواعد تُقارَن ولو لم يُشترك في سؤال', () => {
  // جاهزية الموقع لا تتعلّق بما سُئل. خبرُها صحيحٌ وإن لم يُقارَن الظهور.
  const before = asked([{ id: 'q1', text: 'سؤال أ؟', engine: 'chatgpt', mentioned: true }]);
  const after = asked([{ id: 'q1', text: 'سؤال ب؟', engine: 'chatgpt', mentioned: true }]);
  before.rules.push(rule('machine.sitemap', true, 6));
  after.rules.push(rule('machine.sitemap', false, 6));

  const d = diffScans(before, after);
  assert.equal(d.comparedQuestions, 0);
  assert.deepEqual(d.rules.map((r) => r.change), ['regressed']);
  assert.equal(d.changed, true);
});
