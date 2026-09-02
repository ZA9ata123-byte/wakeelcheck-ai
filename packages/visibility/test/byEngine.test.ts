import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine } from '@wakeelcheck/core';
import { buildMatrix, summarizeByEngine } from '../src/mentions.ts';

/** إجابة مختصرة — الحقول التي يقرأها التجميع وحدها. */
function answer(
  engine: Engine,
  storeMentioned: boolean,
  competitors: { name: string; domain?: string | null }[] = []
) {
  return {
    engine,
    storeMentioned,
    competitors: competitors.map((c) => ({ name: c.name, domain: c.domain ?? null, position: 1 })),
  };
}

const PLAN: Engine[] = ['chatgpt', 'ai_overviews', 'ai_mode'];

// ── الحضور لكل محرّك ─────────────────────────────────────────

test('ثلاث إجابات من ثلاثة محرّكات تعطي ثلاثة صفوف بحضور صحيح', () => {
  const rows = summarizeByEngine(
    [
      answer('chatgpt', true, [{ name: 'بيت الأناقة' }]),
      answer('ai_overviews', false, [{ name: 'أناقتي' }]),
      answer('ai_mode', false, [{ name: 'لمسة رقي' }]),
    ],
    PLAN
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => [r.engine, r.coverage]),
    [
      ['chatgpt', 'mentioned'],
      ['ai_overviews', 'absent'],
      ['ai_mode', 'absent'],
    ]
  );
});

test('الصفوف تتبع ترتيب الخطة لا ترتيب وصول الإجابات', () => {
  const rows = summarizeByEngine(
    [answer('ai_mode', false), answer('chatgpt', true), answer('ai_overviews', false)],
    PLAN
  );

  // العمود يبقى في مكانه، وإلّا قفزت الأعمدة بين فحص وآخر.
  assert.deepEqual(rows.map((r) => r.engine), PLAN);
});

// ── «لم يُقَس» — أهمّ اختبار في الملف ────────────────────────

test('محرّك لم تعد منه إجابة يُعطي not_measured لا absent', () => {
  // ai_mode في الخطة ولم يعد منه شيء — سقط أو لم يُعدّ.
  const rows = summarizeByEngine(
    [answer('chatgpt', true), answer('ai_overviews', false)],
    PLAN
  );

  const aiMode = rows.find((r) => r.engine === 'ai_mode');
  assert.ok(aiMode !== undefined);

  // لو صارت 'absent' لقرأ التاجر عطلاً عندنا غياباً عنده — القاعدة 06.
  assert.equal(aiMode.coverage, 'not_measured');
  assert.equal(aiMode.answers, 0);
  assert.equal(aiMode.storeMentions, 0);
  assert.deepEqual(aiMode.ranked, []);
});

test('لا إجابات إطلاقاً ⇒ كل الأعمدة not_measured', () => {
  const rows = summarizeByEngine([], PLAN);

  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.coverage === 'not_measured'));
});

test('محرّك خارج الخطة لا يُنشئ عموداً', () => {
  // إجابة من محرّك لم يُطلَب: تُهمل بدل أن تخترع عموداً لا يفهمه التاجر.
  const rows = summarizeByEngine([answer('perplexity', true)], ['chatgpt']);

  assert.deepEqual(rows.map((r) => r.engine), ['chatgpt']);
  assert.equal(rows[0]?.coverage, 'not_measured');
});

// ── الحضور عبر عدة أسئلة للمحرّك الواحد ──────────────────────

test('ذِكرٌ في سؤال واحد من ثلاثة يكفي ليكون العمود mentioned', () => {
  const rows = summarizeByEngine(
    [answer('chatgpt', false), answer('chatgpt', true), answer('chatgpt', false)],
    ['chatgpt']
  );

  assert.equal(rows[0]?.coverage, 'mentioned');
  assert.equal(rows[0]?.storeMentions, 1);
  assert.equal(rows[0]?.answers, 3);
});

test('غياب في كل أسئلة المحرّك يعطي absent لا not_measured', () => {
  // الفرق جوهري: هنا قِسنا فعلاً ووجدناه غائباً.
  const rows = summarizeByEngine([answer('chatgpt', false), answer('chatgpt', false)], ['chatgpt']);

  assert.equal(rows[0]?.coverage, 'absent');
  assert.equal(rows[0]?.answers, 2);
});

// ── الهوية الثابتة ───────────────────────────────────────────

test('اسم باختلاف تهجئة يُوحَّد ولا يُعدّ منافسين', () => {
  const rows = summarizeByEngine(
    [
      answer('chatgpt', false, [{ name: 'بيت الأناقة' }]),
      answer('chatgpt', false, [{ name: 'بيت الاناقه' }]),
    ],
    ['chatgpt']
  );

  // ألف بهمزة وبدونها، وتاء مربوطة وهاء — اسم واحد لا اثنان.
  // لو انقسم، لظهر في المرحلة 4 «منافس جديد» وهو نفسه.
  assert.equal(rows[0]?.ranked.length, 1);
  assert.equal(rows[0]?.ranked[0]?.name, 'بيت الأناقة');
});

test('اسم مكرّر داخل إجابة واحدة يُحسب مرة', () => {
  const rows = summarizeByEngine(
    [answer('chatgpt', false, [{ name: 'أناقتي' }, { name: 'أناقتي' }])],
    ['chatgpt']
  );

  assert.equal(rows[0]?.ranked.length, 1);
});

test('المنافسون مرتّبون تنازلياً داخل كل محرّك', () => {
  const rows = summarizeByEngine(
    [
      answer('chatgpt', false, [{ name: 'أناقتي' }, { name: 'بيت الأناقة' }]),
      answer('chatgpt', false, [{ name: 'بيت الأناقة' }]),
    ],
    ['chatgpt']
  );

  assert.deepEqual(rows[0]?.ranked.map((c) => c.name), ['بيت الأناقة', 'أناقتي']);
});

// ── العزل بين المحرّكات ──────────────────────────────────────

test('منافسو محرّك لا يتسرّبون إلى عمود محرّك آخر', () => {
  const rows = summarizeByEngine(
    [
      answer('chatgpt', false, [{ name: 'بيت الأناقة' }]),
      answer('ai_overviews', false, [{ name: 'أناقتي' }]),
    ],
    ['chatgpt', 'ai_overviews']
  );

  assert.deepEqual(rows[0]?.ranked.map((c) => c.name), ['بيت الأناقة']);
  assert.deepEqual(rows[1]?.ranked.map((c) => c.name), ['أناقتي']);
});

test('النطاق يُلتقط من أول ذِكر يحمله', () => {
  const rows = summarizeByEngine(
    [
      answer('chatgpt', false, [{ name: 'بيت الأناقة', domain: null }]),
      answer('chatgpt', false, [{ name: 'بيت الأناقة', domain: 'baitalabaya.sa' }]),
    ],
    ['chatgpt']
  );

  assert.equal(rows[0]?.ranked[0]?.domain, 'baitalabaya.sa');
});

// ── المصفوفة ─────────────────────────────────────────────────

test('المصفوفة تبدأ بصفّ المتجر ثم المنافسين', () => {
  const rows = buildMatrix(
    summarizeByEngine([answer('chatgpt', true, [{ name: 'بيت الأناقة' }])], ['chatgpt']),
    'متجرك'
  );

  assert.equal(rows[0]?.isStore, true);
  assert.equal(rows[0]?.name, 'متجرك');
  assert.equal(rows[1]?.isStore, false);
});

test('اسم باختلاف تهجئة بين محرّكين يعطي صفّاً واحداً', () => {
  const rows = buildMatrix(
    summarizeByEngine(
      [
        answer('chatgpt', false, [{ name: 'بيت الأناقة' }]),
        answer('ai_overviews', false, [{ name: 'بيت الاناقه' }]),
      ],
      ['chatgpt', 'ai_overviews']
    ),
    'متجرك'
  );

  // لو انقسم، لبدا منافسَين اثنين وهو واحد.
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1]?.cells.map((c) => c.state), ['mentioned', 'mentioned']);
  assert.equal(rows[1]?.present, 2);
});

test('عمود لم يُقَس يجعل كل خاناته not_measured — لا غياب من سطح لم يُسأل', () => {
  const rows = buildMatrix(
    summarizeByEngine([answer('chatgpt', false, [{ name: 'أناقتي' }])], ['chatgpt', 'ai_mode']),
    'متجرك'
  );

  const rival = rows[1];
  assert.equal(rival?.cells[0]?.state, 'mentioned');
  assert.equal(rival?.cells[1]?.state, 'not_measured');

  // المقام لا يحسب ما لم يُقَس: 1/1 لا 1/2.
  assert.equal(rival?.measured, 1);
  assert.equal(rival?.present, 1);
});

test('المنافس الأكثر حضوراً يتصدّر', () => {
  const rows = buildMatrix(
    summarizeByEngine(
      [
        answer('chatgpt', false, [{ name: 'قليل' }, { name: 'كثير' }]),
        answer('ai_mode', false, [{ name: 'كثير' }]),
      ],
      ['chatgpt', 'ai_mode']
    ),
    'متجرك'
  );

  assert.deepEqual(rows.slice(1).map((r) => r.name), ['كثير', 'قليل']);
});

test('صفّ المتجر يعكس حالة كل عمود كما هي', () => {
  const rows = buildMatrix(
    summarizeByEngine(
      [answer('chatgpt', true), answer('ai_overviews', false)],
      ['chatgpt', 'ai_overviews', 'ai_mode']
    ),
    'متجرك'
  );

  assert.deepEqual(rows[0]?.cells.map((c) => c.state), ['mentioned', 'absent', 'not_measured']);
  assert.equal(rows[0]?.present, 1);
  assert.equal(rows[0]?.measured, 2);
});
