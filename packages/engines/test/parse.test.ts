import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiModeEngine,
  buildEngines,
  parsePerplexityResponse,
  chatGptEngine,
  copilotEngine,
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
  const none = buildEngines({
    openaiApiKey: null,
    dataforseoLogin: null,
    dataforseoPassword: null,
    perplexityApiKey: null,
  });
  assert.deepEqual(none, [], 'nothing configured means nothing claimed');

  const partial = buildEngines({
    openaiApiKey: 'sk-test',
    dataforseoLogin: null,
    dataforseoPassword: null,
    perplexityApiKey: null,
  });
  assert.deepEqual(partial.map((e) => e.engine), ['chatgpt']);

  const all = buildEngines({
    openaiApiKey: 'sk-test',
    dataforseoLogin: 'l',
    dataforseoPassword: 'p',
    perplexityApiKey: 'pplx-test',
  });
  // copilot يدخل ببيانات DataForSEO نفسها — سطحُ Bing على الحساب ذاته.
  // «مبنيّ» لا يعني «مُشغَّل»: `PLANS` لا تُدرجه، ويحرس ذلك
  // `packages/pipeline/test/plans.test.ts`.
  assert.deepEqual(all.map((e) => e.engine), [
    'chatgpt',
    'ai_overviews',
    'ai_mode',
    'perplexity',
    'copilot',
  ]);

  // مفتاح Perplexity وحده يكفي لإدراجه — ولا يجرّ معه محرّكاً آخر
  const onlyPplx = buildEngines({
    openaiApiKey: null,
    dataforseoLogin: null,
    dataforseoPassword: null,
    perplexityApiKey: 'pplx-test',
  });
  assert.deepEqual(onlyPplx.map((e) => e.engine), ['perplexity']);
});

// ── Perplexity ──────────────────────────────────────────────

test('perplexity: the answer is read from the message content', () => {
  const { text, citedUrls } = parsePerplexityResponse({
    choices: [{ message: { role: 'assistant', content: 'أفضل متجر عبايات هو بيت الأناقة.' } }],
    citations: ['https://baitalabaya.sa/'],
  });
  assert.equal(text, 'أفضل متجر عبايات هو بيت الأناقة.');
  assert.deepEqual(citedUrls, ['https://baitalabaya.sa/']);
});

test('perplexity: search_results is read as a source shape too', () => {
  const { citedUrls } = parsePerplexityResponse({
    choices: [{ message: { content: 'جواب.' } }],
    search_results: [
      { title: 'متجر', url: 'https://a.sa/', date: '2026-08-01' },
      { title: 'آخر', url: 'https://b.sa/' },
    ],
  });
  assert.deepEqual(citedUrls, ['https://a.sa/', 'https://b.sa/']);
});

test('perplexity: the two source shapes merge without duplicates', () => {
  const { citedUrls } = parsePerplexityResponse({
    choices: [{ message: { content: 'جواب.' } }],
    citations: ['https://a.sa/', 'https://b.sa/'],
    search_results: [{ url: 'https://b.sa/' }, { url: 'https://c.sa/' }],
  });
  assert.deepEqual(citedUrls, ['https://a.sa/', 'https://b.sa/', 'https://c.sa/']);
});

test('perplexity: with no declared sources the links come from the text', () => {
  const { citedUrls } = parsePerplexityResponse({
    choices: [{ message: { content: 'انظر https://noura.sa/ للتفاصيل.' } }],
  });
  assert.deepEqual(citedUrls, ['https://noura.sa/']);
});

test('perplexity: a non-string url is ignored, not trusted', () => {
  const { citedUrls } = parsePerplexityResponse({
    choices: [{ message: { content: 'جواب.' } }],
    citations: ['https://ok.sa/', 42, null, 'ftp://no.sa/'],
  });
  assert.deepEqual(citedUrls, ['https://ok.sa/']);
});

test('perplexity: an unexpected shape yields empty rather than throwing', () => {
  assert.deepEqual(parsePerplexityResponse(null), { text: '', citedUrls: [] });
  assert.deepEqual(parsePerplexityResponse('نص'), { text: '', citedUrls: [] });
  assert.deepEqual(parsePerplexityResponse({}), { text: '', citedUrls: [] });
  assert.deepEqual(parsePerplexityResponse({ choices: 'ليست مصفوفة' }), { text: '', citedUrls: [] });
});

test('perplexity: an empty answer is empty — it is not passed off as a result', () => {
  assert.deepEqual(parsePerplexityResponse({ choices: [{ message: { content: '' } }] }), {
    text: '',
    citedUrls: [],
  });
  assert.deepEqual(parsePerplexityResponse({ choices: [{ message: {} }] }), {
    text: '',
    citedUrls: [],
  });
});

// ── Copilot ──────────────────────────────────────────────────

test('copilot يُبنى ببيانات DataForSEO نفسها', () => {
  const engine = copilotEngine({ login: 'user', password: 'pass' });

  assert.equal(engine.engine, 'copilot');
  assert.equal(engine.available, true);
});

test('copilot بلا بيانات اعتماد لا يُنادى ولا يدّعي', () => {
  const engine = copilotEngine({ login: null, password: null });

  assert.equal(engine.available, false);
});

test('copilot يقرأ ردّ DataForSEO بنفس المحلّل', () => {
  // السطح يختلف والبنية واحدة: tasks → result → items.
  const payload = {
    tasks: [
      {
        result: [
          {
            items: [
              { type: 'ai_overview', text: 'أفضل متجر عبايات هو بيت الأناقة.',
                url: 'https://baitalabaya.sa' },
            ],
          },
        ],
      },
    ],
  };

  const { text, citedUrls } = parseDataForSeo(payload);
  assert.ok(text.includes('بيت الأناقة'));
  assert.deepEqual(citedUrls, ['https://baitalabaya.sa']);
});
