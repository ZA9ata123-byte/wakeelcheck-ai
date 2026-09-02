import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuleResult } from '@wakeelcheck/core';
import { compareRules } from '../src/compare.ts';

function rule(key: string, passed: boolean, weight = 5, evidence = ''): RuleResult {
  return { key, passed, weight, detail: { ar: `تفصيل ${key}`, en: `detail ${key}` }, evidence };
}

test('ما ضبطه المنافس وأخفقنا فيه يظهر في ahead', () => {
  const c = compareRules([rule('schema.product', false)], [rule('schema.product', true)]);

  assert.equal(c.ahead.length, 1);
  assert.equal(c.ahead[0]?.ruleKey, 'schema.product');
  assert.deepEqual(c.behind, []);
});

test('ما ضبطناه وأخفق فيه يظهر في behind', () => {
  const c = compareRules([rule('robots.gptbot', true)], [rule('robots.gptbot', false)]);

  assert.deepEqual(c.ahead, []);
  assert.equal(c.behind[0]?.ruleKey, 'robots.gptbot');
});

test('التساوي ليس اختلافاً — نجاحاً كان أو إخفاقاً', () => {
  const c = compareRules(
    [rule('a', true), rule('b', false)],
    [rule('a', true), rule('b', false)]
  );

  assert.deepEqual(c.ahead, []);
  assert.deepEqual(c.behind, []);
  assert.equal(c.compared, 2, 'قِيست عند الطرفين وإن لم تفرّق');
});

test('الدليل من الطرف الناجح — هو وحده عنده ما يُرى', () => {
  const c = compareRules(
    [rule('schema.product', false, 5, 'لا سكيما عندنا')],
    [rule('schema.product', true, 5, '<script type="application/ld+json">')]
  );
  assert.equal(c.ahead[0]?.evidence, '<script type="application/ld+json">');
  assert.equal(c.ahead[0]?.detail.ar, 'تفصيل schema.product');

  const back = compareRules(
    [rule('llms.txt', true, 5, 'وجدناه عندنا')],
    [rule('llms.txt', false, 5, 'لا شيء عنده')]
  );
  assert.equal(back.behind[0]?.evidence, 'وجدناه عندنا');
});

test('قاعدة قِيست عند طرف واحد ليست فجوة', () => {
  // ثقب قياس لا تفوّق. عدُّها فجوةً يخترع سبقاً لم يحدث — القاعدة 06.
  const c = compareRules([rule('a', false)], [rule('a', false), rule('غريبة', true)]);

  assert.deepEqual(c.ahead, []);
  assert.equal(c.compared, 1, 'المقام ما قِيس عند الاثنين');
});

test('الأثقل وزناً أولاً — ترتيب الإصلاح', () => {
  const store = [rule('خفيفة', false, 2), rule('ثقيلة', false, 10), rule('وسط', false, 6)];
  const rival = [rule('خفيفة', true, 2), rule('ثقيلة', true, 10), rule('وسط', true, 6)];

  assert.deepEqual(compareRules(store, rival).ahead.map((d) => d.ruleKey), [
    'ثقيلة',
    'وسط',
    'خفيفة',
  ]);
});

test('الوزن من ميزان المتجر', () => {
  // النتيجة تُقرأ على ميزاننا؛ لو اختلف الوزن عند الطرفين فميزاننا الحكم.
  const c = compareRules([rule('a', false, 7)], [rule('a', true, 99)]);

  assert.equal(c.ahead[0]?.weight, 7);
});

test('طرف بلا قواعد لا ينكسر ولا يخترع فجوة', () => {
  // فحص منافسٍ أخفق قبل التقييم: لا سبق ولا تأخّر، ولا مقام.
  const c = compareRules([rule('a', false), rule('b', true)], []);

  assert.deepEqual(c.ahead, []);
  assert.deepEqual(c.behind, []);
  assert.equal(c.compared, 0);
});

test('الاتجاهان معاً في مقارنة واحدة', () => {
  const c = compareRules(
    [rule('نضبطها', true, 8), rule('يضبطها', false, 9)],
    [rule('نضبطها', false, 8), rule('يضبطها', true, 9)]
  );

  assert.deepEqual(c.ahead.map((d) => d.ruleKey), ['يضبطها']);
  assert.deepEqual(c.behind.map((d) => d.ruleKey), ['نضبطها']);
  assert.equal(c.compared, 2);
});
