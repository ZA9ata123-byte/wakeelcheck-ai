import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDemo, llmChain, llmKeys } from '../lib/llm-env';

/** أيّ مفتاحٍ يُخرج الموقع من الوضع التجريبيّ. */

const KEY = ['test', 'key'].join('-');
const env = (vars: Record<string, string>) => (name: string) => vars[name];

test('مفتاح OpenAI وحده يكفي — لا وضع تجريبيّ', () => {
  // كان يُبقيه تجريبياً: ChatGPT حقيقيّ مدفوع، والاستخراج وهميّ.
  const keys = llmKeys(env({ OPENAI_API_KEY: KEY }));
  assert.equal(isDemo(keys), false);
  assert.deepEqual(llmChain(keys).filter((p) => p.available).map((p) => p.name), ['gpt-5-mini']);
});

test('بلا أيّ مفتاح: تجريبيّ', () => {
  assert.equal(isDemo(llmKeys(env({}))), true);
});

test('المتغيّر الفارغ غياب', () => {
  assert.equal(isDemo(llmKeys(env({ OPENAI_API_KEY: '', DEEPSEEK_API_KEY: '  ' }))), true);
});

test('الترتيب: المجّانيّ ثم الأرخص ثم OpenAI', () => {
  const keys = llmKeys(env({ OPENROUTER_API_KEY: KEY, DEEPSEEK_API_KEY: KEY, OPENAI_API_KEY: KEY }));
  assert.deepEqual(llmChain(keys).map((p) => p.name), ['ox-alpha', 'deepseek-v4-flash', 'gpt-5-mini']);
});
