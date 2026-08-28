/**
 * مخزن مفتاح/قيمة — الواجهة التي تقوم عليها الحدود كلها.
 *
 * تطبيق في الذاكرة للتطوير والاختبار، وتطبيق Redis رقيق للإنتاج.
 * لا شيء في هذه الحزمة يعرف أيّهما يعمل.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** يزيد بمقدار `by` ويضبط انتهاء الصلاحية عند أول إنشاء. يُرجع القيمة بعد الزيادة. */
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
}

interface Entry {
  value: string;
  /** طابع زمني بالمللي ثانية، أو null بلا انتهاء. */
  expiresAt: number | null;
}

export interface MemoryStoreOptions {
  /** ساعة قابلة للحقن — تجعل اختبارات الانتهاء لحظية بدل انتظار حقيقي. */
  now?: () => number;
}

/**
 * مخزن في الذاكرة.
 *
 * كافٍ لعامل واحد ولكل الاختبارات. الإنتاج بعدة عمّال يحتاج Redis حتى
 * يشترك الجميع في العدّاد نفسه — عدّاد لكل عملية يعني ضرب الحدّ في عدد العمّال.
 */
export function memoryStore(opts: MemoryStoreOptions = {}): KeyValueStore {
  const clock = opts.now ?? Date.now;
  const map = new Map<string, Entry>();

  function live(key: string): Entry | null {
    const entry = map.get(key);
    if (entry === undefined) return null;

    if (entry.expiresAt !== null && clock() >= entry.expiresAt) {
      map.delete(key);
      return null;
    }
    return entry;
  }

  return {
    async get(key) {
      return live(key)?.value ?? null;
    },

    async set(key, value, ttlSeconds) {
      map.set(key, {
        value,
        expiresAt: ttlSeconds === undefined ? null : clock() + ttlSeconds * 1000,
      });
    },

    async incrBy(key, by, ttlSeconds) {
      const entry = live(key);
      const next = (entry === null ? 0 : Number(entry.value)) + by;

      map.set(key, {
        value: String(next),
        // النافذة تبدأ عند أول زيادة ولا تتجدّد بعدها — وإلا لأمكن
        // إبقاء العدّاد حياً إلى الأبد بطلبات متتابعة.
        expiresAt: entry?.expiresAt ?? clock() + ttlSeconds * 1000,
      });

      return next;
    },

    async del(key) {
      map.delete(key);
    },
  };
}
