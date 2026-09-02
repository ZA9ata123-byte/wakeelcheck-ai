import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MatrixRow } from '@wakeelcheck/core';
import { selectRivals, DEFAULT_RIVAL_CAP } from '../src/rivals.ts';

function row(
  name: string,
  present: number,
  domain: string | null = `${name}.sa`,
  isStore = false
): MatrixRow {
  return { name, domain, isStore, cells: [], present, measured: 4 };
}

test('يرتّب بالحضور — الأكثر ظهوراً أولاً', () => {
  const { picked } = selectRivals([row('b', 2), row('a', 5), row('c', 3)]);

  assert.deepEqual(picked.map((r) => r.name), ['a', 'c', 'b']);
  assert.equal(picked[0]?.present, 5);
});

test('المتجر نفسه ليس منافساً لنفسه', () => {
  const { picked, skipped } = selectRivals([
    row('متجرك', 7, 'you.sa', true),
    row('منافس', 2),
  ]);

  assert.deepEqual(picked.map((r) => r.name), ['منافس']);
  assert.deepEqual(skipped, [], 'لا يُذكر في السقوط أيضاً — ليس منافساً أصلاً');
});

test('السقف يقطع، والمقطوع يُذكر بسببه', () => {
  const { picked, skipped, cap } = selectRivals(
    [row('a', 5), row('b', 4), row('c', 3), row('d', 2)],
    2
  );

  assert.equal(cap, 2);
  assert.deepEqual(picked.map((r) => r.name), ['a', 'b']);
  assert.deepEqual(skipped, [
    { name: 'c', domain: 'c.sa', reason: 'over_cap' },
    { name: 'd', domain: 'd.sa', reason: 'over_cap' },
  ]);
});

test('اسمٌ بلا نطاق يُصرَّح به ولا يستهلك مقعداً', () => {
  // أقوى منافس بلا نطاق: حجبُه يجعله يختفي بلا أثر — القاعدة 06.
  const { picked, skipped } = selectRivals([row('الأقوى', 7, null), row('b', 1)], 1);

  assert.deepEqual(skipped, [{ name: 'الأقوى', domain: null, reason: 'no_domain' }]);
  assert.deepEqual(picked.map((r) => r.name), ['b'], 'المقعد بقي شاغراً لمن يُفحص');
});

test('نطاق فارغ كغياب النطاق', () => {
  const { picked, skipped } = selectRivals([row('a', 3, '')]);

  assert.deepEqual(picked, []);
  assert.equal(skipped[0]?.reason, 'no_domain');
});

test('لا أحد يضيع — المختار والساقط يساويان المنافسين', () => {
  const matrix = [
    row('متجرك', 7, 'you.sa', true),
    row('a', 5),
    row('b', 4, null),
    row('c', 3),
    row('d', 1),
  ];
  const { picked, skipped } = selectRivals(matrix, 2);

  const rivals = matrix.filter((r) => !r.isStore);
  assert.equal(picked.length + skipped.length, rivals.length);

  const seen = [...picked.map((r) => r.name), ...skipped.map((r) => r.name)].sort();
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
});

test('من لم يظهر في عمود واحد ليس منافساً', () => {
  // صفٌّ بلا حضور لا يسبقك في شيء — لا يُفحص ولا يُذكر.
  const { picked, skipped } = selectRivals([row('شبح', 0), row('a', 2)]);

  assert.deepEqual(picked.map((r) => r.name), ['a']);
  assert.deepEqual(skipped, []);
});

test('التساوي يُحسم بالاسم — ترتيب ثابت قابل للاختبار', () => {
  const first = selectRivals([row('ب', 3), row('أ', 3)]).picked.map((r) => r.name);
  const again = selectRivals([row('أ', 3), row('ب', 3)]).picked.map((r) => r.name);

  assert.deepEqual(first, again, 'ترتيب الورود لا يغيّر النتيجة');
});

test('سقف صفر أو سالب يفحص لا أحد ولا ينكسر', () => {
  for (const cap of [0, -3]) {
    const { picked, skipped, cap: applied } = selectRivals([row('a', 5)], cap);
    assert.deepEqual(picked, [], `cap=${cap}`);
    assert.equal(applied, 0);
    assert.equal(skipped[0]?.reason, 'over_cap');
  }
});

test('مصفوفة فارغة لا تنكسر', () => {
  const { picked, skipped, cap } = selectRivals([]);

  assert.deepEqual(picked, []);
  assert.deepEqual(skipped, []);
  assert.equal(cap, DEFAULT_RIVAL_CAP);
});
