import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoreProfile } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import { addressesSeller, fallbackQuestion, generateQuestions } from '../src/profile.ts';

/**
 * أسئلة الشراء تُوجَّه للمساعد لا للبائع.
 *
 * أوّل فحصٍ حيّ ولّد «Do you have the same dress in petite or plus sizes?»،
 * فأجاب ChatGPT متقمّصاً المتجر: «We do offer many styles…». سؤالٌ كهذا لا
 * يرشّح أحداً، فلا يقيس ظهور أحد.
 */

const profile = (locale = 'ar-KW'): StoreProfile => ({
  domain: 'bellaq8.com',
  platform: 'shopify',
  category: 'ملابس نسائية',
  city: 'الكويت',
  locale,
  currency: 'KWD',
  productUrls: [],
});

const llmReturning = (questions: string[]) =>
  fakeProvider({ fallbackReply: JSON.stringify({ questions: questions.map((text) => ({ text, intent: 'discovery' })) }) });

test('سؤالٌ للبائع يُحذف — وسؤالٌ للمساعد يبقى', async () => {
  const { questions } = await generateQuestions(
    profile(),
    3,
    llmReturning([
      'Do you have the same dress in petite or plus sizes, and does the fit run true to size?',
      'عندكم نفس الفستان بمقاس أكبر؟',
      'وين ألقى فساتين محتشمة أونلاين بالكويت؟',
    ])
  );
  assert.deepEqual(questions.map((q) => q.text), ['وين ألقى فساتين محتشمة أونلاين بالكويت؟']);
});

test('كلّها للبائع: سؤالٌ احتياطيّ يطلب ترشيحاً', async () => {
  const { questions } = await generateQuestions(profile(), 2, llmReturning(['هل لديكم توصيل سريع للكويت؟']));
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.text, 'وش أفضل متجر أونلاين لـملابس نسائية في الكويت؟');
  assert.equal(addressesSeller(questions[0]?.text ?? ''), false);
});

test('ردٌّ لا يُقرأ: سؤالٌ احتياطيّ لا فحصٌ بلا أسئلة', async () => {
  const { questions } = await generateQuestions(profile(), 2, fakeProvider({ fallbackReply: 'not json' }));
  assert.equal(questions.length, 1);
});

test('الاحتياطيّ بلغة الصفحة', () => {
  assert.equal(fallbackQuestion(profile('en')).text, 'What is the best online store for ملابس نسائية in الكويت?');
});

test('ما يُعدّ خطاباً للبائع وما لا يُعدّ', () => {
  for (const seller of ['Do you have it in black?', 'Can you ship to Kuwait?', 'What are your sizes?', 'تبيعون عبايات؟', 'وش أسعاركم؟']) {
    assert.equal(addressesSeller(seller), true, seller);
  }
  for (const shopper of [
    'Where can I buy abayas online in Kuwait?',
    'Which store has the best plus-size dresses?',
    'وش أفضل متجر عبايات بالكويت؟',
    'وين ألقى عطور نسائية بسعر معقول؟',
  ]) {
    assert.equal(addressesSeller(shopper), false, shopper);
  }
});
