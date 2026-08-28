/**
 * الجلب السلبي الآمن.
 *
 * كل شبكة في `packages/` تمرّ من هنا — لا `fetch()` مباشر في أي حزمة أخرى.
 * سلبي بمعنى: ما يفعله متصفح عادي عند زيارة الموقع، ولا شيء أكثر.
 */

import type { FetchOptions, FetchResult } from '@wakeelcheck/core';
import {
  FetchTimeoutError,
  InvalidUrlError,
  PayloadTooLargeError,
  TooManyRedirectsError,
} from '@wakeelcheck/core';
import { assertPublicHost } from './guards.ts';

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  maxRedirects: 3,
} as const;

/** مطابق لمتصفح حقيقي: مواقع كثيرة تحجب وكلاء غير معروفين. */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
};

/** مخطط هرمي صريح مثل `file://` أو `ftp://`. */
const EXPLICIT_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/** مخططات غير هرمية خطيرة لا تنتهي بـ `//`. */
const OPAQUE_SCHEME = /^(javascript|data|vbscript|file|blob|mailto|tel):/i;

/**
 * يضيف https:// إن غابت، ويرفض ما ليس http/https.
 *
 * الحذر هنا مقصود: إضافة البادئة بلا فحص تحوّل `file:///etc/passwd`
 * إلى رابط https غريب يمرّ من الفحص بدل أن يُرفض.
 */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidUrlError(input);

  const explicit = trimmed.match(EXPLICIT_SCHEME);
  if (explicit) {
    const scheme = (explicit[1] as string).toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') throw new InvalidUrlError(input);
  } else if (OPAQUE_SCHEME.test(trimmed)) {
    throw new InvalidUrlError(input);
  }

  const withScheme = explicit ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidUrlError(input);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidUrlError(input);
  }
  return url;
}

/** يقرأ الجسم بحد أقصى للبايتات، ويقطع الاتصال عند التجاوز. */
export async function readCapped(response: Response, url: string, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError(url, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/**
 * يجلب رابطاً بأمان: يتحقق من كل وجهة قبل الاتصال بها، ويعيد التحقق
 * عند كل إعادة توجيه — لأن إعادة التوجيه هي أشهر طريق للالتفاف على حارس SSRF.
 */
export async function safeFetch(input: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects;
  const method = opts.method ?? 'GET';

  let url = normalizeUrl(input);
  const startedAt = Date.now();
  let redirects = 0;

  for (;;) {
    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'manual', // نتبع بأنفسنا لنفحص كل وجهة
        signal: controller.signal,
        headers: { ...DEFAULT_HEADERS, ...opts.headers },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new FetchTimeoutError(url.toString(), timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    const isRedirect = response.status >= 300 && response.status < 400 && location !== null;

    if (isRedirect) {
      if (redirects >= maxRedirects) {
        await response.body?.cancel();
        throw new TooManyRedirectsError(input, maxRedirects);
      }

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new InvalidUrlError(location);
      }
      if (next.protocol !== 'https:' && next.protocol !== 'http:') {
        throw new InvalidUrlError(location);
      }

      await response.body?.cancel();
      url = next;
      redirects++;
      continue; // الدورة القادمة تعيد assertPublicHost على الوجهة الجديدة
    }

    const ttfbMs = Date.now() - startedAt;

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const body = method === 'HEAD' ? '' : await readCapped(response, url.toString(), maxBytes);

    return {
      status: response.status,
      headers,
      body,
      ttfbMs,
      finalUrl: url.toString(),
      redirects,
    };
  }
}
