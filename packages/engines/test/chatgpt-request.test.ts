import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatGptEngine } from '../src/index.ts';

/**
 * ما يُرسل إلى ChatGPT. أوّل فحصٍ حيّ عاد بلا إجابة: جهد التفكير الافتراضيّ
 * مع البحث تجاوز مهلة الفحص.
 */

const KEY = ['test', 'key'].join('-');

test('بحثٌ مفعّل وجهد تفكير منخفض', async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'جواب' }] }] });
  }) as typeof fetch;
  try {
    await chatGptEngine({ apiKey: KEY }).ask('وين ألقى عبايات بالكويت؟', 'ar-KW');
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(body);
  const sent = body as Record<string, unknown>;
  assert.deepEqual(sent['tools'], [{ type: 'web_search' }], 'ما يقوله لزبونٍ حقيقيّ، لا ما يتذكّره');
  assert.deepEqual(sent['reasoning'], { effort: 'low' });
});
