/**
 * المزوّدون: وهمي للاختبار والتطوير، وحقيقيان عبر واجهة متوافقة مع OpenAI.
 */

import { UpstreamError } from '@wakeelcheck/core';
import {
  costMicros,
  estimateTokens,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type Pricing,
} from './provider.ts';

// ── المزوّد الوهمي ───────────────────────────────────────────

export interface FakeScript {
  /** يُطابق نصّ الطلب — أول تطابق يفوز. */
  match: RegExp;
  reply: string;
}

/** المزوّد الوهمي يكشف ما استُدعي به — بلا حاجة إلى cast في الاختبارات. */
export interface FakeProvider extends LlmProvider {
  readonly calls: readonly LlmRequest[];
}

export interface FakeOptions {
  scripts?: FakeScript[];
  /** ردّ افتراضي حين لا يطابق أي سكربت. */
  fallbackReply?: string;
  /** يرمي خطأً دائماً — لاختبار السقوط. */
  alwaysFail?: string;
}

/**
 * مزوّد وهمي يردّ من نصوص محفوظة.
 *
 * ليس أداة اختبار فحسب: هو ما يسمح ببناء المرآة والواجهة والعامل بالكامل
 * قبل توفّر أي مفتاح، فيبقى تبديل المزوّد الحقيقي في النهاية سطراً واحداً.
 */
export function fakeProvider(opts: FakeOptions = {}): FakeProvider {
  const calls: LlmRequest[] = [];

  const provider: FakeProvider = {
    name: 'fake',
    available: true,
    calls,

    async complete(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);

      if (opts.alwaysFail !== undefined) {
        throw new UpstreamError('fake', opts.alwaysFail);
      }

      const script = opts.scripts?.find((s) => s.match.test(req.user));
      const text = script?.reply ?? opts.fallbackReply ?? '{}';

      return {
        text,
        costMicros: 0,
        provider: 'fake',
        inputTokens: estimateTokens(req.system + req.user),
        outputTokens: estimateTokens(text),
      };
    },
  };

  return provider;
}

// ── مزوّد متوافق مع OpenAI ──────────────────────────────────

interface OpenAiCompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  pricing: Pricing;
  /** ترويسات إضافية — OpenRouter يطلب Referer وTitle. */
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function openAiCompatible(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    name: config.name,
    available: config.apiKey !== null,

    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (config.apiKey === null) {
        throw new UpstreamError(config.name, 'missing API key');
      }

      const body = {
        model: config.model,
        messages: [
          // التعليمات الثابتة أولاً: الكاش يعمل على البادئة، ووضع محتوى
          // المتجر المتغيّر قبلها يُلغي الخصم بالكامل.
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 2000,
        ...(req.json === true ? { response_format: { type: 'json_object' } } : {}),
      };

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new UpstreamError(config.name, `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      if (data.error?.message !== undefined) {
        throw new UpstreamError(config.name, data.error.message);
      }

      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw new UpstreamError(config.name, 'empty completion');
      }

      const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(req.system + req.user);
      const outputTokens = data.usage?.completion_tokens ?? estimateTokens(text);

      return {
        text,
        costMicros: costMicros(config.pricing, inputTokens, outputTokens),
        provider: config.name,
        inputTokens,
        outputTokens,
      };
    },
  };
}

/** ox-alpha عبر OpenRouter — مجاني حالياً، ومعاينة لفترة محدودة. */
export function oxAlpha(apiKey: string | null): LlmProvider {
  return openAiCompatible({
    name: 'ox-alpha',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
    model: 'stealth/ox-alpha',
    pricing: { input: 0, output: 0 },
    headers: {
      'HTTP-Referer': 'https://aitchek.online',
      'X-Title': 'WakeelCheck',
    },
  });
}

/**
 * DeepSeek V4-Flash — الاحتياطي المدفوع.
 *
 * التسعير خارج الذروة. أسعار الذروة ضعفها (01:00–04:00 و06:00–10:00 UTC
 * أيام الأسبوع)، فجدولة الفحوصات الدورية ليلاً بتوقيت الخليج توفّر النصف.
 * سعر الإدخال هنا هو سعر عدم إصابة الكاش — الأسوأ، وهو التقدير الآمن.
 */
export function deepSeekFlash(apiKey: string | null): LlmProvider {
  return openAiCompatible({
    name: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey,
    model: 'deepseek-v4-flash',
    pricing: { input: 0.22, output: 0.66 },
  });
}
