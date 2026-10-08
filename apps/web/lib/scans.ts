/**
 * تشغيل الفحص وتخزين نتيجته.
 *
 * المخزن Redis إن ضُبطت متغيّراته، والذاكرة غير ذلك (`lib/store.ts`). والفحص
 * يجري داخل الدالة نفسها عبر `after()` — قياس #9 أثبت أن الفحص السريع يدخل
 * مهلتها، فلا عامل ولا طابور قبل الإطلاق.
 *
 * ما يبقى ثابتاً هو العقد: POST يُنشئ ويعود فوراً، وGET يسأل. الواجهة لا
 * تتغيّر إن انتقل التنفيذ إلى عاملٍ يوماً.
 */

import { randomUUID } from 'node:crypto';
import type { Engine, FetchResult, ScanResult } from '@wakeelcheck/core';
import { safeFetch } from '@wakeelcheck/fetcher';
import { fakeProvider, oxAlpha, deepSeekFlash, withFallback, type LlmProvider } from '@wakeelcheck/llm';
import type { PipelineDeps, SecurityCollected } from '@wakeelcheck/pipeline';
import type { KeyValueStore } from '@wakeelcheck/limits';
import { HARD_DEADLINE_MS, launchScan, withHardDeadline } from './launch';
import { archiveFromEnv, readReport, saveResult, storeFromEnv, type StoreKind } from './store';
import type { StartInput, StartedScan } from './scan-post';
import { buildEngines, type EngineClient } from '@wakeelcheck/engines';
import { collectSecurity as collectReal } from '@wakeelcheck/security';

const shared = storeFromEnv((name) => process.env[name]);

/** الحدود والكاش والإنفاق والنتائج — كلّها في مخزنٍ واحد. */
export const store: KeyValueStore = shared.store;

/** يُعلَن في `/api/health` ليرى الرئيس أيّ مخزنٍ يعمل فعلاً. */
export const storeKind: StoreKind = shared.kind;

/** التقارير الدائمة — `null` بلا قاعدة، فيبقى التقرير يومين في المخزن. */
export const archive = archiveFromEnv((name) => process.env[name]);

export function getScan(id: string): Promise<ScanResult | null> {
  return readReport(store, archive, id);
}

export function putScan(result: ScanResult): Promise<void> {
  return saveResult(store, result);
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

export type { StartedScan } from './scan-post';

/**
 * يبني الفحص من البيئة ويُطلقه.
 *
 * لا ننتظره هنا: الفحص عشرات الثواني، والعقد أن POST يعود فوراً بمعرّف.
 * لكنّه لم يعد متروكاً — `settled` يُمرَّر إلى `after()` في المسار، فتبقى
 * الدالة حيّة حتى يُخزَّن ويُسجَّل إنفاقه. التسوية نفسها في `launch.ts`،
 * حيث تُختبر بلا شبكة.
 */
export function startScan(input: StartInput): StartedScan {
  const { llm, demo } = buildLlm();

  const engines = buildEngines({
    openaiApiKey: process.env['OPENAI_API_KEY'] ?? null,
    dataforseoLogin: process.env['DATAFORSEO_LOGIN'] ?? null,
    dataforseoPassword: process.env['DATAFORSEO_PASSWORD'] ?? null,
    perplexityApiKey: process.env['PERPLEXITY_API_KEY'] ?? null,
  });

  const scanId = randomUUID();
  const deps = withHardDeadline(buildDeps(llm, demo, engines), HARD_DEADLINE_MS);

  const settled = launchScan(
    { ...input, scanId },
    { deps, demo, store, put: putScan, archive }
  );

  return { scanId, demo, settled };
}
