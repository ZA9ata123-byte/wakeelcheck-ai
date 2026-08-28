/**
 * السقوط بين المزوّدين.
 *
 * يحاول بالترتيب ويعود بأول نجاح. يتخطّى غير المتاح بلا محاولة اتصال،
 * ويحوّل فشل الجميع إلى `UpstreamError` واحد يحمل سبب كل محاولة.
 */

import { UpstreamError } from '@wakeelcheck/core';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.ts';

export interface FallbackOptions {
  /** يُستدعى عند سقوط مزوّد — للرصد، لا يؤثر في التدفق. */
  onFallback?: (from: string, err: Error) => void;
}

export function withFallback(
  providers: readonly LlmProvider[],
  opts: FallbackOptions = {}
): LlmProvider {
  const usable = providers.filter((p) => p.available);

  return {
    name: `fallback(${providers.map((p) => p.name).join(' → ')})`,
    available: usable.length > 0,

    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (usable.length === 0) {
        throw new UpstreamError('llm', 'no provider is configured — check API keys');
      }

      const failures: string[] = [];

      for (const provider of usable) {
        try {
          return await provider.complete(req);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          failures.push(`${provider.name}: ${error.message}`);
          opts.onFallback?.(provider.name, error);
        }
      }

      throw new UpstreamError('llm', `all providers failed — ${failures.join('; ')}`);
    },
  };
}

/**
 * يقرأ JSON من ردّ نموذج.
 *
 * النماذج تغلّف JSON بأسوار ```json أو تسبقه بجملة تمهيدية حتى مع طلب
 * صريح بالعكس، لذا نقتطع أول كائن أو مصفوفة متوازنة بدل الوثوق بالشكل.
 */
export function parseJson<T>(text: string): T {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(body) as T;
  } catch {
    // نبحث عن أول بنية متوازنة
  }

  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found in model response');

  const opener = body[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i++) {
    const ch = body[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        return JSON.parse(body.slice(start, i + 1)) as T;
      }
    }
  }

  throw new Error('unbalanced JSON in model response');
}
