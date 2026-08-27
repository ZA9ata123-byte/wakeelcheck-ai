import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiModeEngine,
  buildEngines,
  chatGptEngine,
  parseDataForSeo,
  parseOpenAiResponse,
  urlsIn,
} from '../src/index.ts';

// ── استخراج الروابط ──────────────────────────────────────────

test('urlsIn collects links and drops duplicates', () => {
  const text = 'زر https://a.sa/x وأيضاً https://b.sa ثم https://a.sa/x مرة أخرى';

  assert.deepEqual(urlsIn(text), ['https://a.sa/x', 'https://b.sa']);
});

test('urlsIn stops at punctuation that ends a sentence', () => {
  assert.deepEqual(urlsIn('انظر https://a.sa/page) ثم'), ['https://a.sa/page']);
});

// ── ردّ OpenAI ───────────────────────────────────────────────

test('the convenience field is used when present', () => {
  const parsed = parseOpenAiResponse({ output_text: 'أنصح بـ بيت العباية. https://b.sa' });

  assert.match(parsed.text, /بيت العباية/);
  assert.deepEqual(parsed.citedUrls, ['https://b.sa']);
});

test('text is assembled from the output blocks', () => {
  const payload = {
    output: [
      { content: [{ text: 'من أبرز الخيارات' }, { text: 'بيت العباية.' }] },
      { content: [{ text: 'وأيضاً لمسة رقي.' }] },
    ],
  };

  assert.equal(parseOpenAiResponse(payload).text, 'من أبرز الخيارات\nبيت العباية.\nوأيضاً لمسة رقي.');
});

test('citations are read from annotations when they exist', () => {
  const payload = {
    output: [
      {
        content: [
          {
            text: 'أنصح ببيت العباية',
            annotations: [{ url: 'https://baitalabaya.sa' }, { url: 'https://other.sa' }],
          },
        ],
      },
    ],
  };

  assert.deepEqual(parseOpenAiResponse(payload).citedUrls, [
    'https://baitalabaya.sa',
    'https://other.sa',
  ]);
});

test('with no annotations the links are taken from the text', () => {
  const payload = { output: [{ content: [{ text: 'زر https://b.sa للطلب' }] }] };

  assert.deepEqual(parseOpenAiResponse(payload).citedUrls, ['https://b.sa']);
});

test('an unexpected shape yields empty rather than throwing', () => {
  // شكل الردّ يتغيّر بمرور الوقت؛ التغيّر يجب أن يُفقدنا إجابة لا أن يُسقط الفحص.
  for (const payload of [null, 'text', {}, { output: 'nope' }, { output: [{}] }, { output: [{ content: 'x' }] }]) {
    assert.deepEqual(parseOpenAiResponse(payload), { text: '', citedUrls: [] }, JSON.stringify(payload));
  }
});

test('non-string annotation urls are ignored', () => {
  const payload = {
    output: [{ content: [{ text: 'نص', annotations: [{ url: 42 }, { url: 'ftp://x' }] }] }],
  };

  assert.deepEqual(parseOpenAiResponse(payload).citedUrls, []);
});

// ── ردّ DataForSEO ───────────────────────────────────────────

test('text and links are gathered from the nested task tree', () => {
  const payload = {
    tasks: [
      {
        result: [
          {
            items: [
              { type: 'ai_overview_element', text: 'من أبرز الخيارات بيت العباية.' },
              { type: 'link', url: 'https://baitalabaya.sa', title: 'بيت العباية' },
              { nested: { items: [{ snippet: 'وأيضاً لمسة رقي.' }] } },
            ],
          },
        ],
      },
    ],
  };

  const parsed = parseDataForSeo(payload);

  assert.match(parsed.text, /بيت العباية/);
  assert.match(parsed.text, /لمسة رقي/);
  assert.deepEqual(parsed.citedUrls, ['https://baitalabaya.sa']);
});

test('a repeated snippet appears once', () => {
  const payload = { items: [{ text: 'نفس النص' }, { snippet: 'نفس النص' }] };

  assert.equal(parseDataForSeo(payload).text, 'نفس النص');
});

test('an empty result yields empty text', () => {
  assert.deepEqual(parseDataForSeo({ tasks: [] }), { text: '', citedUrls: [] });
});

test('walking stops before a pathological depth', () => {
  let deep: Record<string, unknown> = { text: 'too deep to reach' };
  for (let i = 0; i < 20; i++) deep = { nested: deep };

  assert.equal(parseDataForSeo(deep).text, '');
});

// ── التوفّر ──────────────────────────────────────────────────

test('an engine without a key is unavailable and never called', async () => {
  const engine = chatGptEngine({ apiKey: null });

  assert.equal(engine.available, false);
  await assert.rejects(() => engine.ask('س', 'ar-SA'), /missing OPENAI_API_KEY/);
});

test('DataForSEO needs both halves of its credentials', () => {
  assert.equal(aiModeEngine({ login: 'x', password: null }).available, false);
  assert.equal(aiModeEngine({ login: null, password: 'y' }).available, false);
  assert.equal(aiModeEngine({ login: 'x', password: 'y' }).available, true);
});

test('buildEngines returns only what is actually configured', () => {
  const none = buildEngines({ openaiApiKey: null, dataforseoLogin: null, dataforseoPassword: null });
  assert.deepEqual(none, [], 'nothing configured means nothing claimed');

  const partial = buildEngines({
    openaiApiKey: 'sk-test',
    dataforseoLogin: null,
    dataforseoPassword: null,
  });
  assert.deepEqual(partial.map((e) => e.engine), ['chatgpt']);

  const all = buildEngines({ openaiApiKey: 'sk-test', dataforseoLogin: 'l', dataforseoPassword: 'p' });
  assert.deepEqual(all.map((e) => e.engine), ['chatgpt', 'ai_overviews', 'ai_mode']);
});
