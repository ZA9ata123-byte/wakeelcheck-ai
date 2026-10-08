/**
 * تجهيزةٌ مشتركة لاختبارات `apps/web` — بلا شبكة ولا مفتاح.
 *
 * خطّ الأنابيب الحقيقي (`runScan`) يجري هنا بتبعياتٍ وهمية، فما يُختبر هو
 * السلوك الذي يراه الزائر لا شكلُ الكود.
 */

import type { FetchResult, ScanResult } from '@wakeelcheck/core';
import { fakeProvider } from '@wakeelcheck/llm';
import type { PipelineDeps, SecurityCollected } from '@wakeelcheck/pipeline';
import { memoryStore, type KeyValueStore } from '@wakeelcheck/limits';
import { launchScan } from '../lib/launch';
import type { ScanPostDeps, StartInput, StartedScan } from '../lib/scan-post';

export const NOW = new Date('2026-10-08T09:00:00Z');

export const ANSWER = 'من أبرز الخيارات بيت العباية — تصاميم راقية وتوصيل سريع.';

const HOME = `<!doctype html><html lang="ar-SA"><head><title>دار الأناقة</title></head>
<body><h1>دار الأناقة</h1><a href="/products/abaya-1">عباية</a></body></html>`;

const SECURITY: SecurityCollected = {
  domainInfo: { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000).toISOString() },
  cert: { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000).toISOString(), protocol: 'TLSv1.3' },
  mail: { spf: 'v=spf1 ~all', dmarc: 'v=DMARC1; p=none' },
  jsAssets: [],
  danglingCnames: [],
};

function page(html: string, url: string): FetchResult {
  return { status: 200, headers: {}, body: html, ttfbMs: 5, finalUrl: url, redirects: 0 };
}

export interface FixtureOptions {
  /** كلفة نداء المحرّك بالميكرو-دولار. */
  engineMicros?: number;
  /** كلفة كلّ نداء نموذج. */
  llmMicros?: number;
  askEngine?: PipelineDeps['askEngine'];
  fetchPage?: PipelineDeps['fetchPage'];
}

export function pipelineDeps(opts: FixtureOptions = {}): PipelineDeps {
  return {
    fetchPage:
      opts.fetchPage ??
      (async (url) => page(HOME, url.includes('/products/') ? url : 'https://daralanaqa.sa/')),
    async fetchText() {
      return null;
    },
    askEngine:
      opts.askEngine ??
      (async () => ({ text: ANSWER, citedUrls: [], costMicros: opts.engineMicros ?? 21_700 })),
    async collectSecurity() {
      return SECURITY;
    },
    llm: fakeProvider({
      scripts: [
        { match: /النطاق:/, reply: '{"category":"عبايات","city":"الرياض","brandName":"دار الأناقة"}' },
        {
          match: /العدد المطلوب/,
          reply: JSON.stringify({
            questions: [
              { text: 'وش أفضل متجر عبايات فخمة بالرياض؟', intent: 'discovery' },
              { text: 'عبايات بأقل من 300 ريال مع توصيل سريع؟', intent: 'price' },
            ],
          }),
        },
      ],
      fallbackReply: '{"competitors":[{"name":"بيت العباية","domain":null}]}',
      costMicrosPerCall: opts.llmMicros ?? 0,
    }),
    now: () => NOW,
    newId: () => 'unused',
  };
}

export interface Harness {
  deps: ScanPostDeps;
  store: KeyValueStore;
  scans: Map<string, ScanResult>;
  /** كم فحصاً بُدئ فعلاً — الكاش يُقاس بما لم يُبدأ. */
  started: () => number;
  /** ينتظر كلَّ ما جُدول عبر `after()`. */
  flush: () => Promise<void>;
}

export function harness(
  opts: FixtureOptions & { demo?: boolean; env?: Record<string, string>; store?: KeyValueStore } = {}
): Harness {
  const store = opts.store ?? memoryStore();
  const scans = new Map<string, ScanResult>();
  const scheduled: Promise<void>[] = [];
  const env: Record<string, string> = { IP_HASH_SALT: 'test-salt', ...opts.env };
  let count = 0;

  const deps: ScanPostDeps = {
    store,
    start(input: StartInput): StartedScan {
      count += 1;
      const scanId = `scan-${count}`;
      const demo = opts.demo ?? false;
      const settled = launchScan(
        { ...input, scanId },
        { deps: pipelineDeps(opts), demo, store, put: (r) => scans.set(r.id, r) }
      );
      return { scanId, demo, settled };
    },
    schedule: (task) => {
      scheduled.push(task);
    },
    env: (name) => env[name],
    now: () => NOW,
  };

  return {
    deps,
    store,
    scans,
    started: () => count,
    flush: async () => {
      await Promise.all(scheduled);
    },
  };
}

/** طلب POST كما يرسله المتصفّح، من عنوانٍ يمكن تغييره لاختبار حدّ الزائر. */
export function post(url: unknown, ip = '203.0.113.7'): Request {
  return new Request('https://aitchek.online/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ url }),
  });
}
