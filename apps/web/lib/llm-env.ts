/**
 * أيّ النماذج تعمل — من البيئة وحدها.
 *
 * يكفي مفتاحٌ واحد من الثلاثة ليخرج الموقع من الوضع التجريبيّ. وكان مفتاح
 * OpenAI وحده يُبقيه تجريبياً: ChatGPT يُسأل فعلاً ويُدفع له، والتوصيف
 * والاستخراج وهميّان، والزائر يرى «وضع تجريبي» فوق إجاباتٍ حقيقية.
 *
 * والمتغيّر الفارغ غياب: Vercel يحفظ `""` إن مُسحت القيمة وبقي الاسم.
 */

import { deepSeekFlash, gpt5Mini, oxAlpha, type LlmProvider } from '@wakeelcheck/llm';

type Env = (name: string) => string | undefined;

export interface LlmKeys {
  openrouter: string | null;
  deepseek: string | null;
  openai: string | null;
}

const present = (v: string | undefined): string | null => (v === undefined || v.trim() === '' ? null : v);

export function llmKeys(env: Env): LlmKeys {
  return {
    openrouter: present(env('OPENROUTER_API_KEY')),
    deepseek: present(env('DEEPSEEK_API_KEY')),
    openai: present(env('OPENAI_API_KEY')),
  };
}

export const isDemo = (k: LlmKeys): boolean => k.openrouter === null && k.deepseek === null && k.openai === null;

/** المجّانيّ، ثم الأرخص، ثم OpenAI. غير المضبوط يُتخطّى بلا اتصال. */
export const llmChain = (k: LlmKeys): LlmProvider[] => [oxAlpha(k.openrouter), deepSeekFlash(k.deepseek), gpt5Mini(k.openai)];
