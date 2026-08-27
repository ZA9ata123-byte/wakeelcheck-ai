import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoreProfile } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import {
  containsTerm,
  detectStoreMention,
  extractCompetitors,
  normalizeArabic,
  storeAliases,
  summarize,
} from '../src/mentions.ts';

const PROFILE: StoreProfile = {
  domain: 'daralanaqa.sa',
  platform: 'salla',
  category: 'عبايات نسائية',
  city: 'الرياض',
  locale: 'ar-SA',
  currency: 'SAR',
  productUrls: [],
};

/** إجابة واقعية كما تخرج من محرك — هذه هي مادة المنتج. */
const ANSWER = `من أبرز الخيارات في الرياض متجر بيت العباية — تصاميم راقية وتوصيل خلال 24 ساعة.
كذلك لمسة رقي معروف بجودة الأقمشة وسياسة إرجاع واضحة، ومتجر أناقتي يوفّر مقاسات
متعددة وأسعاراً مفصّلة. أنصح بمراجعة بيت العباية أولاً.`;

function scripted(json: string) {
  return fakeProvider({ fallbackReply: json });
}

// ── التطبيع ──────────────────────────────────────────────────

test('normalizeArabic unifies the letter shapes merchants actually use', () => {
  assert.equal(normalizeArabic('دار الأناقة'), normalizeArabic('دار الاناقه'));
  assert.equal(normalizeArabic('مُتْجَر'), 'متجر', 'diacritics are dropped');
  assert.equal(normalizeArabic('لمســـة'), 'لمسه', 'tatweel is dropped');
  assert.equal(normalizeArabic('  دار   الأناقة  '), 'دار الاناقه');
});

// ── حدود الكلمة ──────────────────────────────────────────────

test('containsTerm respects Arabic word boundaries', () => {
  assert.equal(containsTerm('مدارس الرياض', 'دار'), false, 'must not match inside a word');
  assert.equal(containsTerm('دار الاناقه للعبايات', 'دار الاناقه'), true);
  assert.equal(containsTerm('زوروا دار.', 'دار'), true, 'punctuation is a boundary');
});

test('containsTerm ignores terms too short to be distinctive', () => {
  assert.equal(containsTerm('في الرياض', 'في'), false);
});

// ── ذكر المتجر ───────────────────────────────────────────────

test('the store is detected by its brand name', () => {
  const text = 'أفضل خيار هو دار الأناقة في الرياض';
  assert.equal(detectStoreMention(text, PROFILE, 'دار الأناقة'), true);
});

test('the store is detected despite different spelling', () => {
  assert.equal(detectStoreMention('جرّب دار الاناقه', PROFILE, 'دار الأناقة'), true);
});

test('the store is detected by its domain', () => {
  assert.equal(detectStoreMention('زوروا daralanaqa.sa للطلب', PROFILE), true);
});

test('a store absent from the answer is not detected', () => {
  assert.equal(detectStoreMention(ANSWER, PROFILE, 'دار الأناقة'), false);
});

test('a generic prefix does not block the match', () => {
  assert.equal(detectStoreMention('متجر دار الأناقة رائع', PROFILE, 'متجر دار الأناقة'), true);
  assert.ok(storeAliases(PROFILE, 'متجر دار الأناقة').includes('دار الاناقه'));
});

// ── استخراج المنافسين ────────────────────────────────────────

test('competitors are extracted and ordered by first appearance', async () => {
  const llm = scripted(
    JSON.stringify({
      competitors: [
        { name: 'أناقتي', domain: null },
        { name: 'بيت العباية', domain: 'baitalabaya.sa' },
        { name: 'لمسة رقي', domain: null },
      ],
    })
  );

  const found = await extractCompetitors(ANSWER, PROFILE, llm, 'دار الأناقة');

  assert.deepEqual(
    found.map((c) => c.name),
    ['بيت العباية', 'لمسة رقي', 'أناقتي'],
    'order follows the text, not the model output'
  );
  assert.deepEqual(
    found.map((c) => c.position),
    [1, 2, 3]
  );
  assert.equal(found[0]?.domain, 'baitalabaya.sa');
});

test('a competitor the model invented is dropped', async () => {
  // النموذج أعاد اسماً معقولاً لكنه غير موجود في النص إطلاقاً.
  const llm = scripted(
    JSON.stringify({
      competitors: [
        { name: 'بيت العباية', domain: null },
        { name: 'قصر العبايات', domain: null },
      ],
    })
  );

  const found = await extractCompetitors(ANSWER, PROFILE, llm, 'دار الأناقة');

  assert.deepEqual(found.map((c) => c.name), ['بيت العباية']);
});

test('the store itself is never listed as its own competitor', async () => {
  const text = 'أنصح بـ دار الأناقة وأيضاً بيت العباية';
  const llm = scripted(
    JSON.stringify({
      competitors: [
        { name: 'دار الأناقة', domain: null },
        { name: 'بيت العباية', domain: null },
      ],
    })
  );

  const found = await extractCompetitors(text, PROFILE, llm, 'دار الأناقة');

  assert.deepEqual(found.map((c) => c.name), ['بيت العباية']);
});

test('duplicate names collapse to one mention', async () => {
  const llm = scripted(
    JSON.stringify({
      competitors: [
        { name: 'بيت العباية', domain: null },
        { name: 'بيت العباية', domain: 'x.sa' },
      ],
    })
  );

  assert.equal((await extractCompetitors(ANSWER, PROFILE, llm, 'دار الأناقة')).length, 1);
});

test('a malformed model reply yields no competitors rather than garbage', async () => {
  const llm = scripted('عذراً، لم أفهم الطلب');
  assert.deepEqual(await extractCompetitors(ANSWER, PROFILE, llm), []);
});

test('JSON wrapped in a code fence is still read', async () => {
  const llm = scripted('```json\n{"competitors":[{"name":"لمسة رقي","domain":null}]}\n```');
  const found = await extractCompetitors(ANSWER, PROFILE, llm, 'دار الأناقة');

  assert.deepEqual(found.map((c) => c.name), ['لمسة رقي']);
});

test('JSON preceded by chatter is still read', async () => {
  const llm = scripted('بالتأكيد! إليك النتيجة: {"competitors":[{"name":"أناقتي","domain":null}]}');
  const found = await extractCompetitors(ANSWER, PROFILE, llm, 'دار الأناقة');

  assert.deepEqual(found.map((c) => c.name), ['أناقتي']);
});

test('an empty answer costs no model call', async () => {
  const llm = fakeProvider({ fallbackReply: '{"competitors":[{"name":"شيء","domain":null}]}' });
  const found = await extractCompetitors('   ', PROFILE, llm);

  assert.deepEqual(found, []);
  assert.equal(llm.calls.length, 0, 'no request should be sent');
});

// ── حصة الصوت ────────────────────────────────────────────────

test('summarize counts store mentions and ranks competitors', () => {
  const summary = summarize([
    { storeMentioned: false, competitors: [{ name: 'بيت العباية', domain: null, position: 1 }] },
    {
      storeMentioned: true,
      competitors: [
        { name: 'بيت العباية', domain: 'b.sa', position: 1 },
        { name: 'لمسة رقي', domain: null, position: 2 },
      ],
    },
    { storeMentioned: false, competitors: [{ name: 'بيت العباية', domain: null, position: 1 }] },
  ]);

  assert.equal(summary.storeMentions, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.ranked[0]?.name, 'بيت العباية');
  assert.equal(summary.ranked[0]?.mentions, 3);
  assert.equal(summary.ranked[0]?.domain, 'b.sa', 'a domain seen once is kept');
  assert.equal(summary.ranked[1]?.mentions, 1);
});

test('a competitor repeated inside one answer counts once', () => {
  const summary = summarize([
    {
      storeMentioned: false,
      competitors: [
        { name: 'بيت العباية', domain: null, position: 1 },
        { name: 'بيت العبايه', domain: null, position: 2 },
      ],
    },
  ]);

  assert.equal(summary.ranked[0]?.mentions, 1, 'spelling variants are the same store');
});

test('summarize handles no answers', () => {
  assert.deepEqual(summarize([]), { storeMentions: 0, total: 0, ranked: [] });
});
