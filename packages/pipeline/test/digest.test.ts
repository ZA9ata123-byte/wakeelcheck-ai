import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineAnswer, RuleResult, ScanResult } from '@wakeelcheck/core';
import { diffScans } from '../src/diff.ts';
import { baselineDigest, countAr, weeklyDigest } from '../src/digest.ts';

/**
 * النشرة — كلّ جملةٍ فيها ادّعاء.
 *
 * تُبنى هنا من `diffScans` الحقيقية على فحوصٍ كاملة، لا من فروقٍ مصنوعة
 * باليد: ما يُختبر هو ما سيقرؤه التاجر فعلاً.
 */

interface Said {
  q: string;
  engine: Engine;
  mentioned: boolean;
  rivals?: string[];
}

function week(said: Said[], rules: RuleResult[] = []): ScanResult {
  const texts = [...new Set(said.map((s) => s.q))];
  const questions = texts.map((text, i) => ({ id: `q${i + 1}`, text, intent: 'discovery' as const }));
  const idOf = new Map(questions.map((q) => [q.text, q.id]));

  const answers: EngineAnswer[] = said.map((s) => ({
    questionId: idOf.get(s.q) ?? 'q?',
    engine: s.engine,
    answerText: '…',
    citedUrls: [],
    storeMentioned: s.mentioned,
    competitors: (s.rivals ?? []).map((name, n) => ({ name, domain: null, position: n + 1 })),
    capturedAt: '2026-10-08T00:00:00Z',
    costMicros: 0,
  }));

  const engines = [...new Set(said.map((s) => s.engine))];
  const byEngine = engines.map((engine) => {
    const mine = answers.filter((a) => a.engine === engine);
    return {
      engine,
      coverage: mine.some((a) => a.storeMentioned) ? ('mentioned' as const) : ('absent' as const),
      storeMentions: mine.filter((a) => a.storeMentioned).length,
      answers: mine.length,
      ranked: [],
    };
  });

  return {
    id: 'w',
    kind: 'monitor',
    status: 'done',
    profile: null,
    questions,
    answers,
    security: [],
    rules,
    shareOfVoice: { store: 0, top: null, total: answers.length, byEngine },
  };
}

const rule = (key: string, passed: boolean, ar: string, weight = 6): RuleResult => ({
  key,
  passed,
  weight,
  detail: { ar, en: key },
  evidence: '',
});

const Q1 = 'وش أفضل متجر عبايات في الرياض؟';
const Q2 = 'عبايات بأقل من 300 ريال؟';

// ── النبرة ───────────────────────────────────────────────────

test('الاختفاء ينبّه، وعنوانه يسمّي المحرّك', () => {
  const d = weeklyDigest(
    diffScans(week([{ q: Q1, engine: 'chatgpt', mentioned: true }]), week([{ q: Q1, engine: 'chatgpt', mentioned: false }])),
    'noura.sa'
  );

  assert.equal(d.tone, 'alert');
  assert.equal(d.headline.ar, 'noura.sa اختفى من ChatGPT هذا الأسبوع');
  assert.equal(d.lines[0]?.ar, 'اختفيتَ من إجابات ChatGPT.');
});

test('منافسٌ ظهر ينبّه — هو تهديدٌ ولو لم تختفِ', () => {
  const d = weeklyDigest(
    diffScans(
      week([{ q: Q1, engine: 'chatgpt', mentioned: false }]),
      week([{ q: Q1, engine: 'chatgpt', mentioned: false, rivals: ['بيت الأناقة'] }])
    ),
    'noura.sa'
  );

  assert.equal(d.tone, 'alert');
  assert.equal(d.lines[0]?.ar, 'ظهر «بيت الأناقة» في إجابات محرّكٍ واحد لم يكن فيها.');
});

test('قاعدةٌ انكسرت تنبّه، بنصّ الحال الآن', () => {
  const d = weeklyDigest(
    diffScans(
      week([{ q: Q1, engine: 'chatgpt', mentioned: true }], [rule('machine.sitemap', true, 'خريطة الموقع متاحة')]),
      week([{ q: Q1, engine: 'chatgpt', mentioned: true }], [rule('machine.sitemap', false, 'خريطة الموقع مفقودة')])
    ),
    'noura.sa'
  );

  assert.equal(d.tone, 'alert');
  assert.ok(d.lines.some((l) => l.ar === 'انكسر: خريطة الموقع مفقودة'));
});

test('التحسّن بلا سوء: أخبارٌ طيّبة', () => {
  const d = weeklyDigest(
    diffScans(week([{ q: Q1, engine: 'perplexity', mentioned: false }]), week([{ q: Q1, engine: 'perplexity', mentioned: true }])),
    'noura.sa'
  );

  assert.equal(d.tone, 'good');
  assert.equal(d.lines[0]?.ar, 'ظهرتَ في إجابات Perplexity.');
});

test('السوء يغلب الحُسن في النبرة، والسوء أوّل السطور', () => {
  const d = weeklyDigest(
    diffScans(
      week([
        { q: Q1, engine: 'chatgpt', mentioned: true },
        { q: Q1, engine: 'perplexity', mentioned: false },
      ]),
      week([
        { q: Q1, engine: 'chatgpt', mentioned: false },
        { q: Q1, engine: 'perplexity', mentioned: true },
      ])
    ),
    'noura.sa'
  );

  assert.equal(d.tone, 'alert');
  assert.ok(d.lines[0]?.ar.startsWith('اختفيتَ'), 'ما يحتاج تدخّلاً أولاً');
  assert.ok(d.lines[1]?.ar.startsWith('ظهرتَ'));
});

// ── «لا تغيّر» ادّعاء ────────────────────────────────────────

test('قورن ولم يتغيّر شيء: هدوء', () => {
  const same = () => week([{ q: Q1, engine: 'chatgpt', mentioned: true }]);
  const d = weeklyDigest(diffScans(same(), same()), 'noura.sa');

  assert.equal(d.tone, 'quiet');
  assert.deepEqual(d.lines, []);
  assert.equal(d.basis.ar, 'قارنّا سؤالاً واحداً على محرّكٍ واحد — السؤال نفسه في الأسبوعين.');
});

test('لم يُقارَن شيء: لا يُدّعى هدوء', () => {
  // أسئلةٌ مختلفة: «لا تغيّر» هنا كذبٌ هادئ. النشرة تقول ما حدث فعلاً.
  const d = weeklyDigest(
    diffScans(week([{ q: Q1, engine: 'chatgpt', mentioned: true }]), week([{ q: Q2, engine: 'chatgpt', mentioned: false }])),
    'noura.sa'
  );

  assert.equal(d.tone, 'incomparable');
  assert.equal(d.headline.ar, 'لم نستطع مقارنة noura.sa هذا الأسبوع');
  assert.ok(d.basis.ar.includes('لم يُقارَن ظهورك'));
});

test('ما لم يُقَس هذا الأسبوع يُذكر — ولا يُقرأ غياباً', () => {
  const before = week([
    { q: Q1, engine: 'chatgpt', mentioned: true },
    { q: Q1, engine: 'perplexity', mentioned: true },
  ]);
  const measured = week([{ q: Q1, engine: 'chatgpt', mentioned: true }]);
  const after: ScanResult = {
    ...measured,
    shareOfVoice: {
      ...measured.shareOfVoice,
      byEngine: [
        ...measured.shareOfVoice.byEngine,
        { engine: 'perplexity', coverage: 'not_measured', storeMentions: 0, answers: 0, ranked: [] },
      ],
    },
  };

  const d = weeklyDigest(diffScans(before, after), 'noura.sa');

  assert.notEqual(d.tone, 'alert', 'عطلُنا ليس خبراً سيّئاً عنه');
  assert.ok(
    d.lines.some((l) => l.ar === 'لم يُقَس هذا الأسبوع: Perplexity — عطلٌ عندنا لا غيابٌ عندك.'),
    d.lines.map((l) => l.ar).join(' | ')
  );
});

// ── اللغة ────────────────────────────────────────────────────

test('العدد ومعدوده بالعربية', () => {
  const forms = { one: 'سؤالاً واحداً', two: 'سؤالين', few: 'أسئلة', many: 'سؤالاً' };
  assert.equal(countAr(1, forms), 'سؤالاً واحداً');
  assert.equal(countAr(2, forms), 'سؤالين');
  assert.equal(countAr(3, forms), '3 أسئلة');
  assert.equal(countAr(10, forms), '10 أسئلة');
  assert.equal(countAr(11, forms), '11 سؤالاً');
});

test('أكثر من محرّك يُعدّ بـ«و» عربيةً وبـand إنجليزية', () => {
  const d = weeklyDigest(
    diffScans(
      week([
        { q: Q1, engine: 'chatgpt', mentioned: true },
        { q: Q1, engine: 'perplexity', mentioned: true },
        { q: Q1, engine: 'ai_mode', mentioned: true },
      ]),
      week([
        { q: Q1, engine: 'chatgpt', mentioned: false },
        { q: Q1, engine: 'perplexity', mentioned: false },
        { q: Q1, engine: 'ai_mode', mentioned: false },
      ])
    ),
    'noura.sa'
  );

  assert.equal(d.lines[0]?.ar, 'اختفيتَ من إجابات ChatGPT، Perplexity و Google AI Mode.');
  assert.equal(d.lines[0]?.en, "You dropped out of ChatGPT, Perplexity and Google AI Mode's answers.");
});

test('كلّ سطرٍ بلغتين', () => {
  const d = weeklyDigest(
    diffScans(
      week([{ q: Q1, engine: 'chatgpt', mentioned: true }], [rule('a', true, 'أ')]),
      week([{ q: Q1, engine: 'chatgpt', mentioned: false, rivals: ['بيت الأناقة'] }], [rule('a', false, 'أ')])
    ),
    'noura.sa'
  );

  for (const line of [d.headline, d.basis, ...d.lines]) {
    assert.ok(line.ar.length > 0 && line.en.length > 0, JSON.stringify(line));
  }
});

// ── أوّل قياس ────────────────────────────────────────────────

test('أوّل قياس: لا يدّعي تغيّراً ولا استقراراً', () => {
  const d = baselineDigest('noura.sa', 3);

  assert.equal(d.tone, 'baseline');
  assert.deepEqual(d.lines, [], 'لا ماضيَ يُقال عنه شيء');
  assert.equal(d.headline.ar, 'بدأنا متابعة noura.sa');
  assert.equal(d.basis.ar, 'هذا أوّل قياس. نعيد 3 أسئلة نفسها كلّ أسبوع، ونخبرك بما تغيّر.');
  assert.ok(!/لا تغيّر|اختفى/.test(d.headline.ar + d.basis.ar));
});
