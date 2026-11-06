import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiModeEngine, parseAiOverview } from '../src/index.ts';

/**
 * Google AI Mode كما عاد حيّاً من DataForSEO (الكويت، العربية، نوفمبر 2026).
 *
 * الجواب كاملٌ في `markdown` أعلى العنصر، ومقطّعٌ مرّةً ثانية في عناصره،
 * ومع كلّ مرجعٍ مقتطفٌ من صفحته. القارئ العامّ القديم جمع النصوص كلّها:
 * الجواب مكرّراً، وكلامُ الصفحات داخل «الدليل الحرفي» (القاعدة 05).
 */

const PAYLOAD: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/ai-mode-kw.json', import.meta.url), 'utf8')
);
const KEY = ['test', 'key'].join('-');

test('الجواب مرّةً واحدة — لا مكرّراً من أجزائه', () => {
  const { text } = parseAiOverview(PAYLOAD) ?? { text: '' };
  assert.equal(text.split('مقسمة حسب تخصصها').length - 1, 1);
});

test('كلام الصفحات المرجعية ليس من الجواب', () => {
  const { text } = parseAiOverview(PAYLOAD) ?? { text: '' };
  assert.ok(!text.includes('Shop 5,000+'), 'مقتطف صفحة The Perfume Smell');
  assert.ok(!text.includes('اكتشف العطور العربية الأصيلة'), 'مقتطف صفحة أجمل');
});

test('ما رآه المستخدم: الاسم مرّة، بلا روابط google ولا إحالات [1]', () => {
  const { text } = parseAiOverview(PAYLOAD) ?? { text: '' };
  assert.ok(!text.includes('google.com/goto'));
  assert.ok(!text.includes('[['), 'إحالات [1] [2]');
  assert.ok(!text.includes('`'));
  assert.ok(!text.includes('SmellThe') && !text.includes('Smell[The'), 'الاسم مكرّراً ملتصقاً');
  // وكلّ اسمٍ رشّحه Google باقٍ بحروفه.
  for (const name of ['The Perfume Smell', 'Perfumes Kuwait', 'أجمل للعطور', 'Ajmal Kuwait']) {
    assert.ok(text.includes(name), name);
  }
  assert.ok(text.startsWith('في الكويت، عندك خيارات ممتازة وموثوقة لشراء العطور أونلاين'));
  assert.ok(text.endsWith('عشان أقدر أدلك على الخيار الأنسب لك؟'));
});

test('المصادر: روابط المواقع نفسها، لا تحويلات google', () => {
  const { citedUrls } = parseAiOverview(PAYLOAD) ?? { citedUrls: [] };
  assert.deepEqual(citedUrls, ['https://ar-kwt.ajmal.com/', 'https://www.theperfumesmell.com/']);
});

test('بلا ai_overview في الردّ: لا جواب يُخترع', () => {
  assert.equal(parseAiOverview({ tasks: [{ result: [{ items: [{ type: 'organic', title: 'x' }] }] }] }), null);
});

test('المحرّك يعيد الجواب المقروء كما هو', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(PAYLOAD)) as typeof fetch;
  try {
    const reply = await aiModeEngine({ login: KEY, password: KEY }).ask('وين ألاقي متاجر عطور أونلاين بالكويت', 'ar-KW');
    assert.equal(reply.text, parseAiOverview(PAYLOAD)?.text);
    assert.equal(reply.costMicros, 4_000);
  } finally {
    globalThis.fetch = original;
  }
});
