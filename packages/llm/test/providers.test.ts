import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepSeekFlash, gpt5Mini } from '../src/providers.ts';

/**
 * ما يُرسل فعلاً إلى كلّ مزوّد. نموذج التفكير يرفض `temperature` و`max_tokens`
 * بخطأ 400 — فيسقط المزوّد الوحيد المضبوط ويفشل كلّ فحص.
 */

// مفتاحٌ يُبنى وقت التشغيل — حارس CI يرفض ما يشبه سرّاً.
const KEY = ['test', 'key'].join('-');

async function captured(call: () => Promise<unknown>): Promise<{ url: string; body: Record<string, unknown>; auth: string }> {
  const original = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen = {
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization') ?? '',
    };
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } });
  }) as typeof fetch;
  try {
    await call();
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(seen, 'لم يُرسل شيء');
  return seen;
}

const req = { system: 's', user: 'u', json: true, maxTokens: 800 };

test('GPT-5 mini: بلا temperature ولا max_tokens، وبأقلّ تفكير', async () => {
  const sent = await captured(() => gpt5Mini(KEY).complete(req));
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.auth, `Bearer ${KEY}`);
  assert.equal(sent.body['model'], 'gpt-5-mini');
  assert.equal(sent.body['max_completion_tokens'], 800);
  assert.equal(sent.body['reasoning_effort'], 'minimal');
  assert.ok(!('temperature' in sent.body), 'temperature يُرفض بخطأ 400');
  assert.ok(!('max_tokens' in sent.body), 'max_tokens يُرفض بخطأ 400');
  assert.deepEqual(sent.body['response_format'], { type: 'json_object' });
});

test('DeepSeek كما كان: temperature وmax_tokens', async () => {
  const sent = await captured(() => deepSeekFlash(KEY).complete(req));
  assert.equal(sent.body['temperature'], 0);
  assert.equal(sent.body['max_tokens'], 800);
  assert.ok(!('max_completion_tokens' in sent.body));
});

test('كلفة GPT-5 mini بسعره: 1000 إدخال و500 إخراج', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })) as typeof fetch;
  try {
    const r = await gpt5Mini(KEY).complete(req);
    // 1000 × 0.25 + 500 × 2 = 1250 دولار للمليون = 1250 ميكرو-دولار.
    assert.equal(r.costMicros, 1250);
  } finally {
    globalThis.fetch = original;
  }
});

test('بلا مفتاح: غير متاح', () => {
  assert.equal(gpt5Mini(null).available, false);
});
