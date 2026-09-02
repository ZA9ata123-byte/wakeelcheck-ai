import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuleResult } from '@wakeelcheck/core';
import { auditRules } from '../src/audit.ts';

function rule(key: string, passed: boolean, weight = 5): RuleResult {
  return {
    key,
    passed,
    weight,
    detail: { ar: '', en: '' },
    evidence: '',
  };
}

function store(domain: string, rules: RuleResult[]) {
  return { domain, rules };
}

test('قاعدة نجحت على كل متجر تُرفع للنظر', () => {
  const audit = auditRules([
    store('a.sa', [rule('robots.file', true)]),
    store('b.sa', [rule('robots.file', true)]),
    store('c.sa', [rule('robots.file', true)]),
  ]);

  // لم تفرّق بين ثلاثة متاجر — تُضخّم النتيجة بلا أن تقيس.
  assert.equal(audit.suspicious.length, 1);
  assert.equal(audit.suspicious[0]?.flag, 'never_failed');
  assert.equal(audit.suspicious[0]?.passed, 3);
});

test('قاعدة رسبت على كل متجر تُرفع كذلك', () => {
  const audit = auditRules([
    store('a.sa', [rule('schema.product', false)]),
    store('b.sa', [rule('schema.product', false)]),
  ]);

  // إمّا مكسورة وإمّا مقيَّمة في الموضع الخطأ.
  assert.equal(audit.suspicious[0]?.flag, 'never_passed');
  assert.deepEqual(audit.suspicious[0]?.failedAt, ['a.sa', 'b.sa']);
});

test('قاعدة فرّقت بين متجرين لا تُرفع', () => {
  const audit = auditRules([
    store('a.sa', [rule('robots.gptbot', true)]),
    store('b.sa', [rule('robots.gptbot', false)]),
  ]);

  assert.deepEqual(audit.suspicious, []);
  assert.equal(audit.rules[0]?.flag, 'ok');
  assert.equal(audit.rules[0]?.passed, 1);
  assert.equal(audit.rules[0]?.total, 2);
});

test('متجر واحد لا يُنتج حكماً', () => {
  // فيه كلّ قاعدة إمّا نجحت تماماً وإمّا أخفقت تماماً — الحكم بلا معنى.
  const audit = auditRules([
    store('a.sa', [rule('robots.file', true), rule('schema.product', false)]),
  ]);

  assert.equal(audit.stores, 1);
  assert.deepEqual(audit.suspicious, []);
  assert.equal(audit.rules.length, 2, 'الإحصاء يبقى، والحكم وحده يُمنع');
});

test('الأثقل وزناً أولاً — الأخطر يُقرأ أولاً', () => {
  const audit = auditRules([
    store('a.sa', [rule('خفيفة', true, 3), rule('ثقيلة', true, 10), rule('وسط', true, 6)]),
    store('b.sa', [rule('خفيفة', true, 3), rule('ثقيلة', true, 10), rule('وسط', true, 6)]),
  ]);

  assert.deepEqual(audit.suspicious.map((r) => r.key), ['ثقيلة', 'وسط', 'خفيفة']);
});

test('أمثلة الإخفاق محدودة — للقراءة لا للإحصاء', () => {
  const stores = Array.from({ length: 9 }, (_, i) => store(`s${i}.sa`, [rule('k', false)]));
  const audit = auditRules(stores);

  assert.equal(audit.rules[0]?.total, 9);
  assert.equal(audit.rules[0]?.failedAt.length, 5, 'خمسة تكفي للقراءة');
});

test('دفعة فارغة لا تنكسر', () => {
  const audit = auditRules([]);

  assert.equal(audit.stores, 0);
  assert.deepEqual(audit.rules, []);
  assert.deepEqual(audit.suspicious, []);
});

test('متجر بلا قواعد لا يُنشئ صفوفاً', () => {
  // فحصٌ أخفق قبل التقييم: يُحسب متجراً ولا يزيد قاعدة.
  const audit = auditRules([store('a.sa', []), store('b.sa', [rule('k', true)])]);

  assert.equal(audit.stores, 2);
  assert.equal(audit.rules.length, 1);
  assert.equal(audit.rules[0]?.total, 1, 'المقام ما قِيس فعلاً لا عدد المتاجر');
});
