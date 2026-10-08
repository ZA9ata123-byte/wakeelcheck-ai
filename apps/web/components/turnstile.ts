'use client';

/**
 * ويدجت Turnstile — جانب الواجهة من #4.
 *
 * `interaction-only`: أغلب الزوّار لا يرون شيئاً، فالحكم يجري في الخلفية.
 * ولا يظهر مربّع «أنا إنسان» إلا لمن يشكّ فيه Cloudflare.
 *
 * والرمز يُستهلك: لكلّ فحصٍ رمز، ويُعاد تحميل الويدجت بعد كلّ إرسال. رمزٌ
 * أُرسل مرّة يرفضه Cloudflare في الثانية.
 *
 * بلا مفتاحٍ عامّ لا يُحمَّل شيء — لا سكربت ولا نداء — والموقع يعمل كما كان.
 */

import { useCallback, useEffect, useRef } from 'react';

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      language?: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** كم ننتظر رمزاً لم يصل بعد قبل أن نرسل بدونه ويتولّى الخادم الرفض. */
const WAIT_MS = 10_000;

export function useTurnstile(siteKey: string | undefined, language: string) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((value: string | null) => void)[]>([]);

  useEffect(() => {
    if (siteKey === undefined || siteKey === '') return;
    let cancelled = false;

    const release = (value: string | null): void => {
      for (const resolve of waiting.current.splice(0)) resolve(value);
    };

    const mount = (): void => {
      if (cancelled || box.current === null || window.turnstile === undefined || widget.current !== null) {
        return;
      }
      widget.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        language,
        callback: (value) => {
          token.current = value;
          release(value);
        },
        'expired-callback': () => {
          token.current = null;
        },
        'error-callback': () => {
          token.current = null;
          release(null);
        },
      });
    };

    if (window.turnstile !== undefined) {
      mount();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (script === null) {
        script = document.createElement('script');
        script.src = SCRIPT;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', mount);
    }

    return () => {
      cancelled = true;
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
      token.current = null;
    };
  }, [siteKey, language]);

  /**
   * الرمز الحاليّ — أو انتظاره إن لم يصل. ثم يُستهلك ويُعاد تحميل الويدجت
   * للفحص التالي. `null` حين لا تحقّق مُعدّاً أو لم يصل رمزٌ في المهلة.
   */
  const take = useCallback(async (): Promise<string | null> => {
    if (siteKey === undefined || siteKey === '') return null;

    const value =
      token.current ??
      (await new Promise<string | null>((resolve) => {
        waiting.current.push(resolve);
        window.setTimeout(() => resolve(null), WAIT_MS);
      }));

    token.current = null;
    if (widget.current !== null) window.turnstile?.reset(widget.current);
    return value;
  }, [siteKey]);

  return { box, take };
}
