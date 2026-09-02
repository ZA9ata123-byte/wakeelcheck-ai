/**
 * محرّكات الإجابة — من نسأل، وكيف نقرأ ردّه.
 *
 * كل محرّك يُقسم إلى محلّل خالص (مُصدَّر ومُختبَر) وغلاف شبكة رقيق.
 * أشكال الردود تتغيّر بمرور الوقت، والتحليل الدفاعي هنا يعني أن تغيّراً
 * في حقل لا يُسقط الفحص بل يُفقده إجابة واحدة.
 *
 * محرّك بلا مفتاح `available: false`، فيُتخطّى بلا محاولة اتصال ولا ادّعاء.
 */

import type { Engine } from '@wakeelcheck/core';
import { UpstreamError } from '@wakeelcheck/core';

export interface EngineReply {
  text: string;
  citedUrls: string[];
  costMicros: number;
}

export interface EngineClient {
  readonly engine: Engine;
  readonly available: boolean;
  ask(question: string, locale: string): Promise<EngineReply>;
}

/** يستخرج كل رابط ظاهر في نص — احتياطي حين لا يُرجع المزوّد استشهادات. */
export function urlsIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [])];
}

// ── ChatGPT عبر واجهة OpenAI ────────────────────────────────

/**
 * يقرأ ردّ Responses API.
 *
 * الردّ مصفوفة عناصر مختلطة: نصّ ونداءات أدوات واستشهادات. نجمع النص
 * ونلتقط الروابط من التعليقات، ونسقط إلى استخراج الروابط من النص حين
 * لا تُرفَق استشهادات.
 */
export function parseOpenAiResponse(payload: unknown): { text: string; citedUrls: string[] } {
  const empty = { text: '', citedUrls: [] };
  if (payload === null || typeof payload !== 'object') return empty;

  const root = payload as Record<string, unknown>;

  // المسار المختصر الذي توفّره الواجهة للراحة
  if (typeof root['output_text'] === 'string' && root['output_text'].length > 0) {
    const text = root['output_text'];
    return { text, citedUrls: urlsIn(text) };
  }

  const output = root['output'];
  if (!Array.isArray(output)) return empty;

  const parts: string[] = [];
  const urls = new Set<string>();

  for (const item of output) {
    if (item === null || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      const chunk = block as { text?: unknown; annotations?: unknown };

      if (typeof chunk.text === 'string') parts.push(chunk.text);

      if (Array.isArray(chunk.annotations)) {
        for (const annotation of chunk.annotations) {
          const url = (annotation as { url?: unknown })?.url;
          if (typeof url === 'string' && url.startsWith('http')) urls.add(url);
        }
      }
    }
  }

  const text = parts.join('\n').trim();
  return { text, citedUrls: urls.size > 0 ? [...urls] : urlsIn(text) };
}

export interface OpenAiOptions {
  apiKey: string | null;
  model?: string;
  /** التكلفة بالدولار لكل مليون توكن — تقدير للمحاسبة. */
  pricing?: { input: number; output: number };
}

export function chatGptEngine(opts: OpenAiOptions): EngineClient {
  const model = opts.model ?? 'gpt-5';

  return {
    engine: 'chatgpt',
    available: opts.apiKey !== null,

    async ask(question, locale) {
      if (opts.apiKey === null) throw new UpstreamError('chatgpt', 'missing OPENAI_API_KEY');

      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          // البحث مفعَّل عمداً: نريد ما يقوله المنتج لزبون حقيقي،
          // لا ما يتذكّره النموذج من تدريبه.
          tools: [{ type: 'web_search' }],
          input: [
            {
              role: 'user',
              content: `${question}\n\n(أجب بلغة السؤال ولهجته، وبإيجاز كما تجيب متسوّقاً.)\nlocale: ${locale}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) throw new UpstreamError('chatgpt', `HTTP ${res.status}`);

      const payload: unknown = await res.json();
      const { text, citedUrls } = parseOpenAiResponse(payload);
      if (text.length === 0) throw new UpstreamError('chatgpt', 'empty answer');

      const usage = (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      const price = opts.pricing ?? { input: 1.25, output: 10 };
      const costMicros = Math.round(
        ((usage?.input_tokens ?? 0) * price.input + (usage?.output_tokens ?? 0) * price.output)
      );

      return { text, citedUrls, costMicros };
    },
  };
}

// ── أسطح Google عبر DataForSEO ──────────────────────────────

/**
 * يقرأ ردّ DataForSEO.
 *
 * البنية متداخلة: tasks → result → items، والعناصر تختلف بين سطح وآخر.
 * نمشي في الشجرة ونجمع كل نص ورابط بدل افتراض شكل ثابت، لأن شكل هذه
 * الأسطح يتغيّر أسرع من أي واجهة أخرى نستهلكها.
 */
export function parseDataForSeo(payload: unknown): { text: string; citedUrls: string[] } {
  const parts: string[] = [];
  const urls = new Set<string>();

  // 12 مستوى: ردود DataForSEO الحقيقية تتداخل عميقاً (tasks → result →
  // items → nested → items)، والحدّ يبقى قائماً ضد مدخل مرضيّ التداخل.
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null) return;

    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const record = node as Record<string, unknown>;

    for (const key of ['text', 'snippet', 'markdown']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) parts.push(value.trim());
    }
    for (const key of ['url', 'link', 'source_url']) {
      const value = record[key];
      if (typeof value === 'string' && value.startsWith('http')) urls.add(value);
    }

    for (const value of Object.values(record)) walk(value, depth + 1);
  };

  walk(payload, 0);

  // نص واحد قد يتكرّر في أكثر من موضع من الشجرة
  const text = [...new Set(parts)].join('\n').trim();
  return { text, citedUrls: [...urls] };
}

export interface DataForSeoOptions {
  login: string | null;
  password: string | null;
  /**
   * مسار السطح. يُترك قابلاً للضبط لأن DataForSEO تُصدر مسارات جديدة
   * لأسطح Google أسرع من دورة إصدارنا — يُثبَّت عند أول نداء حقيقي.
   */
  path?: string;
  locationCode?: number;
  languageCode?: string;
}

function dataForSeoEngine(engine: Engine, defaultPath: string, opts: DataForSeoOptions): EngineClient {
  const available = opts.login !== null && opts.password !== null;

  return {
    engine,
    available,

    async ask(question, locale) {
      if (!available) throw new UpstreamError(engine, 'missing DataForSEO credentials');

      const auth = Buffer.from(`${opts.login}:${opts.password}`).toString('base64');
      const path = opts.path ?? defaultPath;

      const res = await fetch(`https://api.dataforseo.com${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([
          {
            keyword: question,
            location_code: opts.locationCode ?? 2682, // السعودية
            language_code: opts.languageCode ?? locale.split('-')[0] ?? 'ar',
            device: 'mobile',
          },
        ]),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) throw new UpstreamError(engine, `HTTP ${res.status}`);

      const payload: unknown = await res.json();
      const { text, citedUrls } = parseDataForSeo(payload);
      if (text.length === 0) throw new UpstreamError(engine, 'no answer on this surface');

      // التسعير لكل نداء لا لكل توكن — رقم ثابت للمحاسبة.
      return { text, citedUrls, costMicros: 2_600 };
    },
  };
}

export function aiOverviewsEngine(opts: DataForSeoOptions): EngineClient {
  return dataForSeoEngine('ai_overviews', '/v3/serp/google/organic/live/advanced', opts);
}

export function aiModeEngine(opts: DataForSeoOptions): EngineClient {
  return dataForSeoEngine('ai_mode', '/v3/serp/google/ai_mode/live/advanced', opts);
}

/**
 * Copilot عبر سطح Bing في DataForSEO.
 *
 * لا واجهة استهلاكية لـCopilot: واجهة بحث Bing أُغلقت في أغسطس 2025، وما
 * تبقّى مؤسسيّ يجيب من بيانات المؤسسة لا من الويب. فالطريق الوحيد سطحُ
 * Bing عند DataForSEO — **نفس الحساب ونفس بيانات الاعتماد** ونفس المحلّل.
 *
 * ⚠️ **المسار غير مثبَّت.** لم يُنادَ بعدُ نداءً حقيقياً واحداً، وDataForSEO
 * تُصدر مسارات أسطح جديدة أسرع من دورة إصدارنا. لهذا:
 *   ① يبقى خارج كل `ScanPlan` حتى يُثبَّت — فلا يظهر عموداً ولا يُكلّف،
 *   ② `path` قابل للضبط فيُصحَّح بلا إصدار.
 *
 * القاعدة 06: لا نعرض «Copilot» في تقرير تاجر قبل ردٍّ حيّ واحد يُثبته.
 */
export function copilotEngine(opts: DataForSeoOptions): EngineClient {
  return dataForSeoEngine('copilot', '/v3/serp/bing/organic/live/advanced', opts);
}

// ── Perplexity ──────────────────────────────────────────────

/**
 * ردّ Perplexity متوافق مع شكل OpenAI للمحادثات، ويضيف مصادره.
 *
 * المصادر مرّت بثلاثة أشكال عبر الإصدارات: `citations` كمصفوفة نصوص،
 * ثم `search_results` كمصفوفة كائنات، وقد ترد الاثنتان معاً. نقرأ ما
 * نجده ونسقط إلى الروابط الظاهرة في النص — فتغيّر حقل يُفقدنا مصادر
 * إجابة، لا الإجابة نفسها.
 */
export function parsePerplexityResponse(payload: unknown): {
  text: string;
  citedUrls: string[];
} {
  const empty = { text: '', citedUrls: [] };
  if (payload === null || typeof payload !== 'object') return empty;

  const root = payload as Record<string, unknown>;

  const choices = root['choices'];
  if (!Array.isArray(choices)) return empty;

  const parts: string[] = [];
  for (const choice of choices) {
    if (choice === null || typeof choice !== 'object') continue;
    const message = (choice as { message?: unknown }).message;
    if (message === null || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string' && content.length > 0) parts.push(content);
  }

  const text = parts.join('\n').trim();
  if (text.length === 0) return empty;

  const urls = new Set<string>();

  const citations = root['citations'];
  if (Array.isArray(citations)) {
    for (const url of citations) {
      if (typeof url === 'string' && url.startsWith('http')) urls.add(url);
    }
  }

  const results = root['search_results'];
  if (Array.isArray(results)) {
    for (const item of results) {
      const url = (item as { url?: unknown })?.url;
      if (typeof url === 'string' && url.startsWith('http')) urls.add(url);
    }
  }

  // لا مصادر مُعلنة: الروابط الظاهرة في النص أفضل من لا شيء.
  if (urls.size === 0) return { text, citedUrls: urlsIn(text) };

  return { text, citedUrls: [...urls] };
}

export interface PerplexityOptions {
  apiKey: string | null;
  model?: string;
  /** دولاراً لكل مليون رمز. يُمرَّر صراحةً حتى يُصحَّح من الفاتورة لا من الذاكرة. */
  pricing?: { input: number; output: number };
}

export function perplexityEngine(opts: PerplexityOptions): EngineClient {
  const model = opts.model ?? 'sonar';

  return {
    engine: 'perplexity',
    available: opts.apiKey !== null,

    async ask(question, locale) {
      if (opts.apiKey === null) throw new UpstreamError('perplexity', 'missing PERPLEXITY_API_KEY');

      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: `${question}\n\n(أجب بلغة السؤال ولهجته، وبإيجاز كما تجيب متسوّقاً.)\nlocale: ${locale}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) throw new UpstreamError('perplexity', `HTTP ${res.status}`);

      const payload: unknown = await res.json();
      const { text, citedUrls } = parsePerplexityResponse(payload);
      if (text.length === 0) throw new UpstreamError('perplexity', 'empty answer');

      const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
        .usage;
      // الافتراضي تقديريّ ويجب أن يُصحَّح من أول فاتورة — القاعدة 06.
      const price = opts.pricing ?? { input: 1, output: 1 };
      const costMicros = Math.round(
        (usage?.prompt_tokens ?? 0) * price.input + (usage?.completion_tokens ?? 0) * price.output
      );

      return { text, citedUrls, costMicros };
    },
  };
}

// ── التجميع ──────────────────────────────────────────────────

export interface EngineEnv {
  openaiApiKey: string | null;
  dataforseoLogin: string | null;
  dataforseoPassword: string | null;
  perplexityApiKey: string | null;
}

/** المحرّكات المتاحة فعلاً. غير المُعدّ لا يُدرج، فلا يُسأل ولا يُدَّعى. */
export function buildEngines(env: EngineEnv): EngineClient[] {
  const dfs = { login: env.dataforseoLogin, password: env.dataforseoPassword };

  return [
    chatGptEngine({ apiKey: env.openaiApiKey }),
    aiOverviewsEngine(dfs),
    aiModeEngine(dfs),
    perplexityEngine({ apiKey: env.perplexityApiKey }),
    // مبنيّ ومتاح ببيانات DataForSEO نفسها، وغير مُدرَج في أي خطّة بعد.
    copilotEngine(dfs),
  ].filter((client) => client.available);
}
