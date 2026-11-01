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
  assert.deepEqual(sent['tools'], [{ type: 'web_search', search_context_size: 'low' }], 'ما يقوله لزبونٍ حقيقيّ، لا ما يتذكّره');
  assert.deepEqual(sent['reasoning'], { effort: 'low' });
});

import { aiModeEngine, locationFor } from '../src/index.ts';

test('Google يُسأل من بلد المتجر لا من السعودية دائماً', async () => {
  assert.equal(locationFor('ar-KW'), 2414);
  assert.equal(locationFor('ar-AE'), 2784);
  assert.equal(locationFor('ar'), 2682, 'بلا منطقة: السعودية كما كان');

  const original = globalThis.fetch;
  let sent: { location_code?: number; language_code?: string }[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as typeof sent;
    return Response.json({ tasks: [{ result: [{ items: [{ markdown: 'جواب' }] }] }] });
  }) as typeof fetch;
  try {
    await aiModeEngine({ login: KEY, password: KEY }).ask('وين ألقى عطور بالكويت؟', 'ar-KW');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sent[0]?.location_code, 2414);
  assert.equal(sent[0]?.language_code, 'ar');
});
