/**
 * تشغيل الفحص وتخزين نتيجته.
 *
 * حالياً في الذاكرة وفي نفس العملية. هذا مقصود ومؤقّت: البنية النهائية
 * (docs/01) تضع الفحص في طابور Redis ويلتقطه عامل على Contabo، لأن الفحص
 * يستغرق عشرات الثواني ودوال Vercel تنتهي مهلتها قبله.
 *
 * ما يبقى ثابتاً بين الحالتين هو العقد: POST يُنشئ ويعود فوراً، وGET يسأل.
 * الواجهة لا تتغيّر حين ينتقل التنفيذ إلى العامل.
 */

import { randomUUID } from 'node:crypto';
import type { Engine, FetchResult, ScanKind, ScanResult } from '@wakeelcheck/core';
import { safeFetch } from '@wakeelcheck/fetcher';
import { fakeProvider, oxAlpha, deepSeekFlash, withFallback, type LlmProvider } from '@wakeelcheck/llm';
import { runScan, type PipelineDeps, type SecurityCollected } from '@wakeelcheck/pipeline';
import { memoryStore, type KeyValueStore } from '@wakeelcheck/limits';
import { buildEngines, type EngineClient } from '@wakeelcheck/engines';
import { collectSecurity as collectReal } from '@wakeelcheck/security';

const scans = new Map<string, ScanResult>();

/** مشترك بين الطلبات في عملية واحدة — يصبح Redis في الإنتاج. */
export const limitStore: KeyValueStore = memoryStore();

export function getScan(id: string): ScanResult | null {
  return scans.get(id) ?? null;
}

export function putScan(result: ScanResult): void {
  scans.set(result.id, result);
}

// ── المزوّد ──────────────────────────────────────────────────

/**
 * يبني سلسلة النماذج من البيئة.
 *
 * بلا مفاتيح نعمل بمزوّد وهمي: كل المنتج يعمل من طرف إلى طرف، والبيانات
 * واضحة أنها تجريبية. هذا ما يجعل بناء الواجهة والعامل ممكناً قبل فتح
 * أي حساب — وتشغيل الحقيقي لاحقاً تغيير قيمة في البيئة، لا تغيير كود.
 */
export function buildLlm(): { llm: LlmProvider; demo: boolean } {
  const openrouter = process.env['OPENROUTER_API_KEY'] ?? null;
  const deepseek = process.env['DEEPSEEK_API_KEY'] ?? null;

  if (openrouter === null && deepseek === null) {
    return { llm: demoLlm(), demo: true };
  }

  return {
    llm: withFallback([oxAlpha(openrouter), deepSeekFlash(deepseek)]),
    demo: false,
  };
}

const DEMO_ANSWER = (category: string, city: string | null): string => {
  const where = city === null ? '' : ` في ${city}`;
  return (
    `من أبرز الخيارات${where} متجر بيت الأناقة — تشكيلة واسعة وتوصيل خلال 24 ساعة. ` +
    `كذلك لمسة رقي معروف بجودة المنتجات وسياسة إرجاع واضحة، ` +
    `و${category} من متجر أناقتي يوفّر مقاسات متعددة وأسعاراً مفصّلة.`
  );
};

function demoLlm(): LlmProvider {
  return fakeProvider({
    scripts: [
      {
        match: /النطاق:/,
        reply: '{"category":"منتجات المتجر","city":null,"brandName":null}',
      },
      {
        match: /العدد المطلوب/,
        reply: JSON.stringify({
          questions: [
            { text: 'وش أفضل متجر في هذا المجال؟', intent: 'discovery' },
            { text: 'أرخص خيار مع توصيل سريع؟', intent: 'price' },
          ],
        }),
      },
    ],
    fallbackReply: JSON.stringify({
      competitors: [
        { name: 'بيت الأناقة', domain: null },
        { name: 'لمسة رقي', domain: null },
        { name: 'أناقتي', domain: null },
      ],
    }),
  });
}

// ── التبعيات ─────────────────────────────────────────────────

function buildDeps(llm: LlmProvider, demo: boolean, engines: EngineClient[]): PipelineDeps {
  // فحص الأسرار يحتاج سكربتات الصفحة، ويلتقطها الجالب قبل أن يُطلب الأمان.
  const lastHtml = { html: '', url: '' };

  return {
    async fetchPage(url: string): Promise<FetchResult> {
      const page = await safeFetch(url, { timeoutMs: 12_000, maxBytes: 2_000_000 });
      if (lastHtml.html === '') {
        lastHtml.html = page.body;
        lastHtml.url = page.finalUrl;
      }
      return page;
    },

    async fetchText(url: string): Promise<string | null> {
      try {
        const res = await safeFetch(url, { timeoutMs: 5_000, maxBytes: 500_000 });
        return res.status === 200 && res.body.length > 0 ? res.body : null;
      } catch {
        return null;
      }
    },

    async askEngine(engine: Engine, question: string, locale: string) {
      const client = engines.find((e) => e.engine === engine);

      if (client === undefined) {
        if (demo) return { text: DEMO_ANSWER('المنتج', null), citedUrls: [], costMicros: 0 };
        // محرّك غير مُعدّ: نصرّح بذلك بدل اختراع إجابة — القاعدة 06.
        throw new Error(`engine ${engine} is not configured`);
      }

      return client.ask(question, locale);
    },

    async collectSecurity(domain: string): Promise<SecurityCollected> {
      // RDAP و TLS و DNS — كلها عامة ومجانية، ولا يحتاج أيّ منها مفتاحاً.
      // كل مصدر يسقط وحده، والغائب يعود فارغاً فلا يُنتج التقييم نتيجة
      // عمّا لا يعرفه.
      return collectReal(domain, lastHtml.html, lastHtml.url);
    },

    llm,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

// ── التشغيل ──────────────────────────────────────────────────

export interface StartedScan {
  scanId: string;
  demo: boolean;
}

/**
 * يُنشئ فحصاً ويشغّله في الخلفية.
 *
 * لا ننتظره: الفحص عشرات الثواني، والعقد أن POST يعود فوراً بمعرّف.
 */
export function startScan(url: string, kind: ScanKind): StartedScan {
  const { llm, demo } = buildLlm();

  const engines = buildEngines({
    openaiApiKey: process.env['OPENAI_API_KEY'] ?? null,
    dataforseoLogin: process.env['DATAFORSEO_LOGIN'] ?? null,
    dataforseoPassword: process.env['DATAFORSEO_PASSWORD'] ?? null,
    perplexityApiKey: process.env['PERPLEXITY_API_KEY'] ?? null,
  });

  const deps = buildDeps(llm, demo, engines);
  const scanId = randomUUID();

  putScan({
    id: scanId,
    kind,
    status: 'running',
    profile: null,
    questions: [],
    answers: [],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 0 },
  });

  void runScan({ url, kind }, { ...deps, newId: () => scanId })
    .then(({ result }) => putScan(result))
    .catch((err: unknown) => {
      putScan({
        id: scanId,
        kind,
        status: 'failed',
        profile: null,
        questions: [],
        answers: [],
        security: [],
        rules: [],
        shareOfVoice: { store: 0, top: null, total: 0 },
        error: err instanceof Error ? err.message : 'scan failed',
      });
    });

  return { scanId, demo };
}
