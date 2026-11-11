/**
 * فاحص زواحف الذكاء الاصطناعي — أداة مجانية بلا تسجيل.
 *
 * يقرأ robots.txt المنشور لنطاقٍ ما، ويقول لكلّ زاحف: مسموح أم محظور،
 * وهل هو زاحف بحثٍ مباشر (يقرّر الظهور في الإجابات) أم زاحف تدريب.
 *
 * ## ما لا نفعله
 *
 * لا ننتحل هوية زاحف (User-Agent مزيّف) لنختبر حظر Cloudflare: الحماية
 * تتحقّق من الزواحف الحقيقية بعناوينها، فالطلب المزيّف يُحظر حتى حين يُسمح
 * للحقيقي — نتيجةٌ كاذبة. نقول ذلك للتاجر بدل أن نخمّن.
 *
 * طلبٌ واحد عبر safeFetch (القاعدة 02)، وحدٌّ لكلّ زائر، ولا كلفة نموذج.
 */

import type { FetchResult } from '@wakeelcheck/core';
import { isAllowed, isNamed, parseRobots } from '@wakeelcheck/readiness';
import { hashIp, type KeyValueStore } from '@wakeelcheck/limits';
import { normalizeUrl } from '@wakeelcheck/fetcher';

export interface CrawlerSpec {
  agent: string;
  purpose: 'search' | 'training';
  engine: { ar: string; en: string };
}

/** نفس الفصل الذي في قواعد الجاهزية — بحثٌ مباشر أولاً. */
export const CHECKED_CRAWLERS: readonly CrawlerSpec[] = [
  { agent: 'OAI-SearchBot', purpose: 'search', engine: { ar: 'بحث ChatGPT', en: 'ChatGPT Search' } },
  { agent: 'ChatGPT-User', purpose: 'search', engine: { ar: 'ChatGPT بطلب مستخدم', en: 'ChatGPT on user request' } },
  { agent: 'Googlebot', purpose: 'search', engine: { ar: 'Google وإجاباته الذكية', en: 'Google and its AI answers' } },
  { agent: 'Bingbot', purpose: 'search', engine: { ar: 'Bing وCopilot', en: 'Bing and Copilot' } },
  { agent: 'PerplexityBot', purpose: 'search', engine: { ar: 'Perplexity', en: 'Perplexity' } },
  { agent: 'Claude-SearchBot', purpose: 'search', engine: { ar: 'بحث Claude', en: 'Claude search' } },
  { agent: 'Claude-User', purpose: 'search', engine: { ar: 'Claude بطلب مستخدم', en: 'Claude on user request' } },
  { agent: 'GPTBot', purpose: 'training', engine: { ar: 'تدريب ChatGPT', en: 'ChatGPT training' } },
  { agent: 'ClaudeBot', purpose: 'training', engine: { ar: 'تدريب Claude', en: 'Claude training' } },
  { agent: 'Google-Extended', purpose: 'training', engine: { ar: 'تدريب Gemini', en: 'Gemini training' } },
];

export interface CrawlerVerdict {
  agent: string;
  purpose: 'search' | 'training';
  engine: { ar: string; en: string };
  allowed: boolean;
  /** مذكورٌ باسمه في الملف — ترحيبٌ صريح أو حظرٌ صريح. */
  named: boolean;
}

export interface CrawlerReport {
  domain: string;
  /** `present`: ملفٌ قُرئ. `absent`: لا ملف (404) — لا قيد على أحد. */
  robots: 'present' | 'absent';
  verdicts: CrawlerVerdict[];
  /** زواحف البحث المحظورة — ما يُخفي المتجر من الإجابات. */
  blockedSearch: string[];
}

export type Fetcher = (url: string, opts?: { timeoutMs?: number; maxBytes?: number }) => Promise<FetchResult>;

export class RobotsUnavailableError extends Error {
  constructor(public readonly status: number | null) {
    super(`robots.txt unavailable: ${status ?? 'network'}`);
    this.name = 'RobotsUnavailableError';
  }
}

/** نطاقٌ من مدخل الزائر، أو `null`. */
export function domainFrom(input: string): string | null {
  try {
    const host = normalizeUrl(input).hostname.toLowerCase();
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
    return host;
  } catch {
    return null;
  }
}

export async function checkCrawlers(domain: string, fetchRobots: Fetcher): Promise<CrawlerReport> {
  let res: FetchResult;
  try {
    res = await fetchRobots(`https://${domain}/robots.txt`, { timeoutMs: 8_000, maxBytes: 512 * 1024 });
  } catch {
    throw new RobotsUnavailableError(null);
  }

  let text: string | null;
  if (res.status === 404 || res.status === 410) text = null;
  else if (res.status >= 200 && res.status < 300) text = res.body;
  else throw new RobotsUnavailableError(res.status);

  const robots = parseRobots(text);
  const verdicts = CHECKED_CRAWLERS.map((c) => ({
    ...c,
    allowed: isAllowed(robots, c.agent, '/'),
    named: isNamed(robots, c.agent),
  }));

  return {
    domain,
    robots: text === null ? 'absent' : 'present',
    verdicts,
    blockedSearch: verdicts.filter((v) => v.purpose === 'search' && !v.allowed).map((v) => v.agent),
  };
}

// ── المسار ───────────────────────────────────────────────────

export interface CrawlerCheckDeps {
  fetch: Fetcher;
  store: KeyValueStore;
  salt: string;
  /** فحوصٌ لكلّ زائر في الساعة. */
  perHour?: number;
}

export const CRAWLER_CHECKS_PER_HOUR = 30;

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '0.0.0.0';
}

export async function handleCrawlerCheck(req: Request, deps: CrawlerCheckDeps): Promise<Response> {
  const domain = domainFrom(new URL(req.url).searchParams.get('domain') ?? '');
  if (domain === null) return Response.json({ error: 'invalid_domain' }, { status: 400 });

  const limit = deps.perHour ?? CRAWLER_CHECKS_PER_HOUR;
  const key = `tool:crawlers:${hashIp(clientIp(req), deps.salt)}`;
  let used: number;
  try {
    used = await deps.store.incrBy(key, 1, 3600);
  } catch {
    // المخزن معطّل: الأداة رخيصة، فتعمل بلا حدّ بدل أن تتوقّف.
    used = 0;
  }
  if (used > limit) return Response.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const report = await checkCrawlers(domain, deps.fetch);
    return Response.json(report, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof RobotsUnavailableError) {
      return Response.json({ error: 'robots_unavailable', status: err.status }, { status: 502 });
    }
    return Response.json({ error: 'unreachable' }, { status: 502 });
  }
}
