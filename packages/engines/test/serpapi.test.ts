import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEngines, parseSerpApiAiMode, serpApiAiModeEngine } from '../src/index.ts';

/**
 * Google AI Mode عبر SerpApi. الشكل من وثائقه، ويُثبَّت بأوّل ردٍّ حيّ —
 * ما لم يثبت يبقى هنا مذكوراً لا مفترضاً.
 */

const KEY = ['test', 'serp', 'key'].join('-');

test('النصّ من الإجابة وحدها — لا مقتطفات المراجع', () => {
  const { text, citedUrls } = parseSerpApiAiMode({
    text_blocks: [
      { type: 'paragraph', snippet: 'هذي أبرز متاجر العطور في الكويت:' },
      { type: 'list', list: [{ snippet: 'Nazakah — أصالة مضمونة.' }, { snippet: 'Livish — توصيل سريع.' }] },
    ],
    references: [
      { title: 'نزاكة', link: 'https://nazakah.com/', snippet: 'مقتطفٌ من الصفحة لا من الإجابة' },
      { title: 'ليفش', link: 'https://www.livish.com/' },
    ],
  });

  assert.equal(text, 'هذي أبرز متاجر العطور في الكويت:\n- Nazakah — أصالة مضمونة.\n- Livish — توصيل سريع.');
  assert.ok(!text.includes('مقتطفٌ من الصفحة'), 'القاعدة 05: لا كلام لم يقله المحرّك');
  assert.deepEqual(citedUrls, ['https://nazakah.com/', 'https://www.livish.com/']);
});

test('reconstructed_markdown أولاً إن وُجد', () => {
  const { text } = parseSerpApiAiMode({ reconstructed_markdown: '## عطور\n- Nazakah', text_blocks: [{ snippet: 'x' }] });
  assert.equal(text, '## عطور\n- Nazakah');
});

test('يُسأل من بلد المتجر ولغته، والمفتاح لا يظهر في الخطأ', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = (async (u: string | URL) => {
    url = String(u);
    return Response.json({ error: 'Google hasn\'t returned any results for this query.' });
  }) as typeof fetch;
  try {
    await assert.rejects(serpApiAiModeEngine({ apiKey: KEY }).ask('وين ألقى عطور؟', 'ar-KW'), (err: Error) => {
      assert.ok(!err.message.includes(KEY), 'القاعدة 01');
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
  const params = new URL(url).searchParams;
  assert.equal(params.get('engine'), 'google_ai_mode');
  assert.equal(params.get('gl'), 'kw');
  assert.equal(params.get('hl'), 'ar');
});

test('مع SERPAPI_KEY: AI Mode من SerpApi، وبلاه: DataForSEO كما كان', () => {
  const env = { openaiApiKey: null, dataforseoLogin: null, dataforseoPassword: null, perplexityApiKey: null };
  assert.deepEqual(buildEngines({ ...env, serpApiKey: KEY }).map((e) => e.engine), ['ai_mode']);
  assert.deepEqual(buildEngines(env).map((e) => e.engine), [], 'بلا مفتاح: لا محرّك يُدّعى');
});
