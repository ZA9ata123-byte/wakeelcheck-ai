import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamError } from '@wakeelcheck/core';
import { parseJson, withFallback } from '../src/fallback.ts';
import { fakeProvider } from '../src/providers.ts';
import { costMicros, estimateTokens, type LlmProvider } from '../src/provider.ts';

const REQ = { system: 'sys', user: 'ask' };

// ── السقوط بين المزوّدين ─────────────────────────────────────

test('the first working provider answers', async () => {
  const llm = withFallback([
    fakeProvider({ fallbackReply: 'primary' }),
    fakeProvider({ fallbackReply: 'secondary' }),
  ]);

  assert.equal((await llm.complete(REQ)).text, 'primary');
});

test('a failing primary falls through to the backup', async () => {
  // ox-alpha معاينة مجانية لفترة محدودة — هذا المسار هو خطة نجاتنا منها.
  const fallen: string[] = [];
  const llm = withFallback(
    [fakeProvider({ alwaysFail: 'preview ended' }), fakeProvider({ fallbackReply: 'backup' })],
    { onFallback: (from) => fallen.push(from) }
  );

  assert.equal((await llm.complete(REQ)).text, 'backup');
  assert.deepEqual(fallen, ['fake'], 'the fallback is observable for monitoring');
});

test('when every provider fails the reasons are all reported', async () => {
  const llm = withFallback([
    fakeProvider({ alwaysFail: 'rate limited' }),
    fakeProvider({ alwaysFail: 'bad gateway' }),
  ]);

  await assert.rejects(
    () => llm.complete(REQ),
    (err: unknown) => {
      assert.ok(err instanceof UpstreamError);
      assert.match(err.message, /rate limited/);
      assert.match(err.message, /bad gateway/);
      return true;
    }
  );
});

test('providers without a key are skipped, never called', async () => {
  let attempted = false;
  const keyless: LlmProvider = {
    name: 'keyless',
    available: false,
    async complete() {
      attempted = true;
      throw new Error('should never run');
    },
  };

  const llm = withFallback([keyless, fakeProvider({ fallbackReply: 'ok' })]);

  assert.equal((await llm.complete(REQ)).text, 'ok');
  assert.equal(attempted, false);
});

test('with no configured provider the error names the cause', async () => {
  const llm = withFallback([{ name: 'a', available: false, complete: async () => { throw new Error(); } }]);

  assert.equal(llm.available, false);
  await assert.rejects(() => llm.complete(REQ), /no provider is configured/);
});

test('the fallback name shows the order for logs', () => {
  const llm = withFallback([fakeProvider(), fakeProvider()]);
  assert.match(llm.name, /fallback\(fake → fake\)/);
});

// ── قراءة JSON من ردود النماذج ───────────────────────────────

test('parseJson reads plain JSON', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
});

test('parseJson unwraps a code fence', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('```\n[1,2]\n```'), [1, 2]);
});

test('parseJson finds JSON after preamble chatter', () => {
  assert.deepEqual(parseJson('بالتأكيد، إليك: {"a":1} أتمنى أن يفيدك'), { a: 1 });
});

test('parseJson respects braces inside strings', () => {
  const parsed = parseJson<{ name: string }>('{"name":"متجر } الأناقة"}');
  assert.equal(parsed.name, 'متجر } الأناقة');
});

test('parseJson respects escaped quotes', () => {
  const parsed = parseJson<{ q: string }>('{"q":"قال \\"مرحباً\\" ثم غادر"}');
  assert.match(parsed.q, /مرحباً/);
});

test('parseJson handles nested structures', () => {
  const parsed = parseJson<{ a: { b: number[] } }>('noise {"a":{"b":[1,2,{"c":3}]}} tail');
  assert.deepEqual(parsed.a.b[2], { c: 3 });
});

test('parseJson throws when there is no JSON at all', () => {
  assert.throws(() => parseJson('عذراً لم أفهم'), /no JSON found/);
});

test('parseJson throws on an unterminated structure', () => {
  assert.throws(() => parseJson('{"a":1'), /unbalanced JSON/);
});

// ── التكلفة ──────────────────────────────────────────────────

test('costMicros matches the DeepSeek V4-Flash off-peak rate card', () => {
  // مليون إدخال بلا كاش = 0.22$، ومليون إخراج = 0.66$
  assert.equal(costMicros({ input: 0.22, output: 0.66 }, 1_000_000, 0), 220_000);
  assert.equal(costMicros({ input: 0.22, output: 0.66 }, 0, 1_000_000), 660_000);
});

test('a free provider costs nothing', () => {
  assert.equal(costMicros({ input: 0, output: 0 }, 500_000, 200_000), 0);
});

test('a realistic scan is fractions of a cent', () => {
  // ~27k إدخال و4k إخراج لكل فحص مرآة
  const micros = costMicros({ input: 0.22, output: 0.66 }, 27_000, 4_000);
  assert.ok(micros < 10_000, `${micros} micros should be under one cent`);
});

test('estimateTokens counts Arabic denser than Latin', () => {
  const arabic = estimateTokens('عبايات نسائية فاخرة');
  const latin = estimateTokens('luxury abayas for women');

  assert.ok(arabic > 0 && latin > 0);
  assert.ok(arabic / 19 > latin / 23, 'Arabic should cost more tokens per character');
});

test('the fake provider records what it was asked', async () => {
  const llm = fakeProvider({ scripts: [{ match: /عبايات/, reply: 'matched' }] });

  assert.equal((await llm.complete({ system: 's', user: 'أفضل عبايات' })).text, 'matched');
  assert.equal((await llm.complete({ system: 's', user: 'شيء آخر' })).text, '{}');
  assert.equal(llm.calls.length, 2);
});
