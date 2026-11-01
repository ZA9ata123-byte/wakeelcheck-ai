import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuleResult } from '@wakeelcheck/core';
import { citeHost, parseAnswer, parseInline } from '../lib/answer-format';
import { pickCause } from '../lib/cause';

// ── الإجابة: بنيتها لا كلماتها ───────────────────────────────

const words = (s: string): string => s.replace(/[\s()[\]*\-•]+/g, '');

test('القائمة والرابط والعريض — وكلّ كلمةٍ باقية', () => {
  const text = 'تبي أونلاين بالكويت؟ هذي خيارات:\n- **Livish**: عطور عالمية. ([livish.com](https://www.livish.com/?utm_source=openai))\n- Nazakah: أصالة 100%.';
  const blocks = parseAnswer(text);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, 'p');
  assert.equal(blocks[1]?.kind === 'list' && blocks[1].items.length, 2);
  const first = blocks[1]?.kind === 'list' ? blocks[1].items[0] : [];
  assert.deepEqual(first?.[0], { kind: 'strong', text: 'Livish' });
  assert.ok(first?.some((p) => p.kind === 'cite' && p.href.startsWith('https://www.livish.com/')));

  // القاعدة 05: لا كلمة تُحذف ولا تُضاف — النصّ الظاهر هو نصّ الإجابة.
  const shown = blocks
    .flatMap((b) => (b.kind === 'p' ? [b.inline] : b.items))
    .flat()
    .map((p) => (p.kind === 'cite' ? p.label : p.text))
    .join('');
  assert.equal(words(shown), words(text.replace(/\(https?:[^)]+\)/g, '')));
});

test('قائمةٌ ملتصقة في سطرٍ واحد تُفصل', () => {
  const blocks = parseAnswer('خيارات مجرّبة: - Livish: عالمية. - Nazakah: أصالة. - Zosouq: سريع.');
  assert.equal(blocks[0]?.kind, 'p');
  assert.equal(blocks[1]?.kind === 'list' && blocks[1].items.length, 3);
});

test('رابطٌ بلا أقواس، ونصٌّ بلا رموز', () => {
  assert.deepEqual(parseInline('انظر [موقع](https://x.com/a) هنا'), [
    { kind: 'text', text: 'انظر ' },
    { kind: 'cite', label: 'موقع', href: 'https://x.com/a' },
    { kind: 'text', text: ' هنا' },
  ]);
  assert.deepEqual(parseInline('نصٌّ عاديّ'), [{ kind: 'text', text: 'نصٌّ عاديّ' }]);
  assert.equal(citeHost('https://www.kuwaitlocal.com/x', 'k'), 'kuwaitlocal.com');
});

// ── «لماذا حدث» من قواعد المتجر ──────────────────────────────

const rule = (key: string, passed: boolean, weight: number, fixSnippet?: string): RuleResult => ({
  key,
  passed,
  weight,
  detail: { ar: key, en: key },
  evidence: '',
  ...(fixSnippet === undefined ? {} : { fixSnippet }),
});

test('السبب: الأثقل بين ما أخفق — لا GPTBot ثابتاً', () => {
  const cause = pickCause([
    rule('robots.gptbot', true, 10),
    rule('schema.rating', false, 7),
    rule('schema.brand', false, 5),
  ]);
  assert.equal(cause?.key, 'schema.rating', 'GPTBot مسموحٌ هنا، فلا يُدّعى حجبه');
});

test('عند التعادل: ما له إصلاحٌ جاهز', () => {
  assert.equal(pickCause([rule('a', false, 7), rule('b', false, 7, '<script>')])?.key, 'b');
});

test('كلّ القواعد ناجحة: لا سبب يُخترع', () => {
  assert.equal(pickCause([rule('a', true, 9)]), null);
});
