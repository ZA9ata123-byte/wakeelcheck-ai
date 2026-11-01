import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerSources } from '../lib/sources';

test('مصدرٌ لكلّ موقع، بلا وسوم التتبّع', () => {
  // كما عادت من ChatGPT في فحصٍ حيّ لمتجر عطور كويتيّ.
  const sources = answerSources([
    'https://www.livish.com/?utm_source=openai',
    'https://nazakah.com/?utm_source=openai',
    'https://nazakah.com/collections/oud?utm_source=openai',
    'https://www.perfumeskuwait.com/about-us/?utm_source=openai&ref=x',
  ]);

  assert.deepEqual(sources, [
    { host: 'livish.com', href: 'https://www.livish.com/' },
    { host: 'nazakah.com', href: 'https://nazakah.com/' },
    { host: 'perfumeskuwait.com', href: 'https://www.perfumeskuwait.com/about-us/?ref=x' },
  ]);
});

test('ما ليس رابط ويب لا يُعرض', () => {
  assert.deepEqual(answerSources(['javascript:alert(1)', 'not a url', 'ftp://x.com/a']), []);
});

test('ستّة على الأكثر', () => {
  const many = Array.from({ length: 10 }, (_, i) => `https://s${i}.com/`);
  assert.equal(answerSources(many).length, 6);
});
