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
  city: null,
  country: 'الكويت',
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

// ── البلد والعملة من أدلّة الصفحة ─────────────────────────────

import { detectCountry, detectCurrency } from '../src/profile.ts';

test('«مدارس» و«عندك» ليستا عملة', () => {
  // كان «ر.?س» بلا حدود يطابق «مدارس»، فقُرئ متجرٌ كويتيّ سعودياً.
  assert.equal(detectCurrency('<p>ألعاب تعليمية للمدارس وفارس الصغير، وكل ما عندك</p>'), null);
});

test('العملة: الدليل البنيويّ أوّلاً، ثم الرمز وحده', () => {
  assert.equal(detectCurrency('<script>{"priceCurrency":"KWD"}</script><p>للمدارس</p>'), 'KWD');
  assert.equal(detectCurrency('<meta property="product:price:currency" content="SAR">'), 'SAR');
  assert.equal(detectCurrency('<span>29.500 د.ك</span>'), 'KWD');
  assert.equal(detectCurrency('<span>السعر: 120 ر.س</span>'), 'SAR');
});

test('البلد: النطاق، ثم الهاتف، ثم اللغة، ثم العملة', () => {
  assert.equal(detectCountry('', 'shop.com.kw', null, 'SAR'), 'الكويت', 'نطاق البلد يغلب');
  assert.equal(detectCountry('<a href="https://wa.me/96560648080">واتساب</a>', 'aboalizz.com', 'ar', 'SAR'), 'الكويت', 'الهاتف يغلب العملة');
  assert.equal(detectCountry('', 'x.com', 'ar-AE', null), 'الإمارات');
  assert.equal(detectCountry('', 'x.com', 'ar', 'KWD'), 'الكويت');
  assert.equal(detectCountry('', 'x.com', 'ar', null), null, 'بلا دليل: لا بلد');
});

test('رقمٌ عاديّ لا يُقرأ هاتفاً مصرياً', () => {
  assert.equal(detectCountry('<p>الطلب رقم 2024 و 00201 قطعة</p>', 'x.com', 'ar', null), null);
});

test('بلا بلد: لا يُذكر مكانٌ في الاحتياطيّ', () => {
  assert.equal(
    fallbackQuestion({ ...profile(), country: null }).text,
    'وش أفضل متجر أونلاين لـملابس نسائية؟'
  );
});

import { countryCode, regionalLocale } from '../src/profile.ts';

test('المحرّكات تُسأل من بلد المتجر', () => {
  assert.equal(countryCode('الكويت'), 'kw');
  assert.equal(regionalLocale('ar', 'الكويت'), 'ar-KW');
  // البلد يغلب منطقة اللغة: صفحةٌ بـar-SA ورقمٍ كويتيّ متجرٌ كويتيّ.
  assert.equal(regionalLocale('ar-SA', 'الكويت'), 'ar-KW');
  assert.equal(regionalLocale('en', 'الإمارات'), 'en-AE');
  assert.equal(regionalLocale('ar-SA', null), 'ar-SA', 'بلا بلد: كما هي');
});
