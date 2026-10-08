/**
 * مخزنٌ مشترك عبر Redis — #3.
 *
 * `memoryStore` عدّادٌ لكلّ نسخة. ودوال المنصّة تُفتح بالعشرات تحت الضغط،
 * فحدُّ «ثلاثة فحوص في اليوم» يصير ثلاثةً لكلّ نسخة، والسقف الشهريّ يُحسب
 * في كلّ نسخةٍ وحدها، والكاش لا يراه إلا من كتبه. هنا يشترك الجميع في
 * العدّاد نفسه.
 *
 * ## لماذا REST لا TCP
 *
 * واجهة Upstash فوق HTTP: لا اتصال يُفتح ويُدار في دالةٍ تعيش ثوانٍ، ولا
 * تبعية جديدة في الحزمة. نداءٌ واحد لكلّ أمر، و`fetch` محقون فيُختبر بلا شبكة.
 *
 * والرابط من البيئة لا من الزائر، فليس مسار SSRF — كنداءات المحرّكات تماماً.
 */

import type { KeyValueStore } from './store.ts';

export interface RedisStoreOptions {
  /** `UPSTASH_REDIS_REST_URL`. */
  url: string;
  /** `UPSTASH_REDIS_REST_TOKEN`. لا يُطبع ولا يُسجَّل — القاعدة 01. */
  token: string;
  fetch?: typeof fetch;
  /** مهلة الأمر الواحد. Redis يجيب في مللي ثوانٍ؛ ما يتجاوز هذا عطل. */
  timeoutMs?: number;
}

type Command = (string | number)[];

/**
 * عطلٌ في المخزن المشترك.
 *
 * الرسالة لا تحمل الرابط ولا الرمز: تصل إلى سجلّ أو ردّ، وكلاهما خارج
 * القاعدة 01.
 */
export class StoreUnavailableError extends Error {
  constructor(detail: string) {
    super(`shared store unavailable: ${detail}`);
    this.name = 'StoreUnavailableError';
  }
}

export function redisStore(opts: RedisStoreOptions): KeyValueStore {
  const send = opts.fetch ?? fetch;
  const base = opts.url.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 3_000;

  async function call(command: Command): Promise<unknown> {
    let res: Response;
    try {
      res = await send(base, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command.map(String)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new StoreUnavailableError(err instanceof Error ? err.name : 'network');
    }

    let payload: { result?: unknown; error?: unknown };
    try {
      payload = (await res.json()) as { result?: unknown; error?: unknown };
    } catch {
      throw new StoreUnavailableError(`HTTP ${res.status}, unreadable body`);
    }

    if (!res.ok || payload.error !== undefined) {
      const reason = typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`;
      throw new StoreUnavailableError(reason);
    }

    return payload.result ?? null;
  }

  return {
    async get(key) {
      const value = await call(['GET', key]);
      return typeof value === 'string' ? value : null;
    },

    async set(key, value, ttlSeconds) {
      await call(ttlSeconds === undefined ? ['SET', key, value] : ['SET', key, value, 'EX', ttlSeconds]);
    },

    async incrBy(key, by, ttlSeconds) {
      // `INCRBY` ذرّيّ في Redis: لا قراءةَ ثم كتابة، فلا سباق بين نسختين.
      // وهو ما يجعل `consumeIpQuota` صحيحاً حين يصل طلبان في اللحظة نفسها.
      const next = Number(await call(['INCRBY', key, by]));

      // النافذة تبدأ عند أول زيادة ولا تتجدّد بعدها — كـ`memoryStore` حرفياً.
      // فلا يُضبط الانتهاء إلا لمفتاحٍ بلا انتهاء (-1). ولو سبقت نسختان معاً
      // ضبطتاه بالقيمة نفسها، فلا ضرر.
      if (Number(await call(['TTL', key])) === -1) {
        await call(['EXPIRE', key, ttlSeconds]);
      }

      return next;
    },

    async del(key) {
      await call(['DEL', key]);
    },
  };
}
