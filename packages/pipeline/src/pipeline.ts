/**
 * خط الأنابيب — يربط المحرّكات في فحص واحد.
 *
 * كل ما يلامس العالم الخارجي يُحقن عبر `PipelineDeps`. لا شبكة ولا ساعة
 * ولا مولّد معرّفات داخل هذا الملف، فالفحص كاملاً يُختبر بمزوّدين وهميين.
 *
 * مبدأ حاكم: فشل جزء لا يُسقط الكل. محرك لا يجيب، أو توصيف يفشل، أو فحص
 * أمني متعذّر — كلها تُسجَّل ويكمل الفحص بما توفّر. تقرير ناقص أنفع من
 * لا تقرير.
 */

import type {
  Engine,
  EngineAnswer,
  FetchResult,
  ScanKind,
  ScanResult,
  SecurityFinding,
} from '@wakeelcheck/core';
import type { LlmProvider } from '@wakeelcheck/llm';
import { runReadiness, parseRobots, type PageSnapshot } from '@wakeelcheck/readiness';
import { evaluateSecurity, type SecurityInput } from '@wakeelcheck/security';
import {
  buildProfile,
  detectStoreMention,
  extractCompetitors,
  generateQuestions,
  summarize,
} from '@wakeelcheck/visibility';

/** ما يُجمع من الشبكة للفحص الأمني — يُحقن جاهزاً. */
export type SecurityCollected = Omit<SecurityInput, 'domain' | 'now' | 'headers' | 'https' | 'html'>;

export interface EngineReply {
  text: string;
  citedUrls: string[];
  costMicros: number;
}

export interface PipelineDeps {
  fetchPage(url: string): Promise<FetchResult>;
  /** يُرجع null حين لا يوجد الملف — robots.txt و llms.txt و sitemap.xml. */
  fetchText(url: string): Promise<string | null>;
  askEngine(engine: Engine, question: string, locale: string): Promise<EngineReply>;
  collectSecurity(domain: string): Promise<SecurityCollected>;
  llm: LlmProvider;
  now(): Date;
  newId(): string;
}

/** ما يفعله كل نوع فحص — هذا ما يفصل المجاني عن المدفوع. */
export interface ScanPlan {
  questions: number;
  engines: Engine[];
  productPages: number;
  security: boolean;
  readiness: boolean;
}

export const PLANS: Record<ScanKind, ScanPlan> = {
  // المجاني: تشخيصٌ كامل — عشرون قاعدة وفحصٌ أمني وسؤالان على محرّك واحد.
  // التشخيص هو ما يُري التاجر أن المشكلة حقيقية؛ والمُباع هو المتابعة:
  // ما الذي تغيّر الأسبوع الماضي. إخفاء التشخيص يُخفي الدليل لا يبيعه.
  quick: { questions: 2, engines: ['chatgpt'], productPages: 2, security: true, readiness: true },
  full: {
    questions: 10,
    engines: ['chatgpt', 'ai_overviews', 'ai_mode', 'perplexity'],
    productPages: 5,
    security: true,
    readiness: true,
  },
  monitor: {
    questions: 10,
    engines: ['chatgpt', 'ai_overviews', 'ai_mode', 'perplexity'],
    productPages: 5,
    security: true,
    readiness: true,
  },
};

export interface ScanRequest {
  url: string;
  kind: ScanKind;
}

export interface ScanOutcome {
  result: ScanResult;
  costMicros: number;
  /** أخطاء غير قاتلة — للرصد، لا تُعرض للتاجر. */
  warnings: string[];
}

function toSnapshot(fetched: FetchResult): PageSnapshot {
  return {
    url: fetched.finalUrl,
    status: fetched.status,
    headers: fetched.headers,
    html: fetched.body,
  };
}

function emptyResult(id: string, kind: ScanKind): ScanResult {
  return {
    id,
    kind,
    status: 'running',
    profile: null,
    questions: [],
    answers: [],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 0 },
  };
}

export async function runScan(req: ScanRequest, deps: PipelineDeps): Promise<ScanOutcome> {
  const plan = PLANS[req.kind];
  const id = deps.newId();
  const warnings: string[] = [];
  let costMicros = 0;

  const note = (step: string, err: unknown): void => {
    warnings.push(`${step}: ${err instanceof Error ? err.message : String(err)}`);
  };

  // ── 1. الصفحة الرئيسية — الفشل هنا وحده قاتل ────────────────
  let home: FetchResult;
  try {
    home = await deps.fetchPage(req.url);
  } catch (err) {
    return {
      result: {
        ...emptyResult(id, req.kind),
        status: 'failed',
        error: err instanceof Error ? err.message : 'could not reach the store',
      },
      costMicros: 0,
      warnings,
    };
  }

  const domain = new URL(home.finalUrl).hostname.replace(/^www\./, '');
  const base = `https://${domain}`;

  // ── 2. الملفات المقروءة آلياً ───────────────────────────────
  const [robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
    deps.fetchText(`${base}/robots.txt`).catch(() => null),
    deps.fetchText(`${base}/llms.txt`).catch(() => null),
    deps.fetchText(`${base}/sitemap.xml`).catch(() => null),
  ]);

  // ── 3. التوصيف ──────────────────────────────────────────────
  const { profile, brandName, costMicros: profileCost } = await buildProfile(
    home.body,
    domain,
    home.finalUrl,
    sitemapXml,
    deps.llm,
    plan.productPages
  );
  costMicros += profileCost;

  // ── 4. صفحات المنتجات ───────────────────────────────────────
  const products: PageSnapshot[] = [];
  for (const url of profile.productUrls) {
    try {
      products.push(toSnapshot(await deps.fetchPage(url)));
    } catch (err) {
      note(`product ${url}`, err);
    }
  }

  // ── 5. الجاهزية ─────────────────────────────────────────────
  const rules = plan.readiness
    ? runReadiness({
        domain,
        home: toSnapshot(home),
        products,
        robots: parseRobots(robotsTxt),
        llmsTxt,
        sitemapFound: sitemapXml !== null,
      }).results
    : [];

  // ── 6. الأسئلة ──────────────────────────────────────────────
  let questions: Awaited<ReturnType<typeof generateQuestions>>['questions'] = [];
  try {
    const generated = await generateQuestions(profile, plan.questions, deps.llm);
    questions = generated.questions;
    costMicros += generated.costMicros;
  } catch (err) {
    note('questions', err);
  }

  // ── 7. سؤال المحرّكات ───────────────────────────────────────
  const answers: EngineAnswer[] = [];

  for (const question of questions) {
    for (const engine of plan.engines) {
      try {
        const reply = await deps.askEngine(engine, question.text, profile.locale);
        costMicros += reply.costMicros;

        const competitors = await extractCompetitors(
          reply.text,
          profile,
          deps.llm,
          brandName ?? undefined
        );

        answers.push({
          questionId: question.id,
          engine,
          // حرفياً كما خرج — القاعدة الملزمة رقم 05.
          answerText: reply.text,
          citedUrls: reply.citedUrls,
          storeMentioned: detectStoreMention(reply.text, profile, brandName ?? undefined),
          competitors,
          capturedAt: deps.now().toISOString(),
          costMicros: reply.costMicros,
        });
      } catch (err) {
        note(`${engine}/${question.id}`, err);
      }
    }
  }

  // ── 8. الأمان ───────────────────────────────────────────────
  let security: SecurityFinding[] = [];
  if (plan.security) {
    try {
      const collected = await deps.collectSecurity(domain);
      security = evaluateSecurity({
        ...collected,
        domain,
        now: deps.now(),
        headers: home.headers,
        https: home.finalUrl.startsWith('https://'),
        html: home.body,
      });
    } catch (err) {
      note('security', err);
    }
  }

  // ── 9. التجميع ──────────────────────────────────────────────
  const summary = summarize(answers);
  const top = summary.ranked[0];

  return {
    result: {
      id,
      kind: req.kind,
      status: 'done',
      profile,
      questions,
      answers,
      security,
      rules,
      shareOfVoice: {
        store: summary.storeMentions,
        top: top === undefined ? null : { name: top.name, domain: top.domain, position: 1 },
        total: summary.total,
      },
    },
    costMicros,
    warnings,
  };
}
