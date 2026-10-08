/**
 * POST /api/scan — منطق المسار بلا Next.
 *
 * المسار نفسه محوّلٌ من أسطر قليلة. القرار كلّه هنا، وكلُّ ما يلامس العالم
 * يُحقن، فيُختبر القبولُ والكاش والميزانية بلا خادم ولا مفتاح — القاعدة 09.
 *
 * الترتيب ملزم (القاعدة 04): الكاش، ثم الميزانية، ثم رصيد الزائر. الكاش
 * أولاً لأن الإجابة المحفوظة لا تُكلّف شيئاً ولا تستهلك رصيد أحد.
 */

import { isWakeelError, type ScanKind } from '@wakeelcheck/core';
import { normalizeUrl } from '@wakeelcheck/fetcher';
import { StoreUnavailableError, admit, hashIp, type KeyValueStore } from '@wakeelcheck/limits';
import { SOFT_BUDGET_MS } from './launch';
import { VerificationUnavailableError, type HumanVerifier } from './turnstile';

/**
 * السقف الشهريّ حين لا يُضبط في البيئة.
 *
 * كان 300 دولار والرصيد الفعليّ عشرون. سقفٌ افتراضيّ أعلى من الرصيد ليس
 * سقفاً. فيُرفع في البيئة لمن يملك أكثر، ولا يُنسى فيحرق.
 */
export const DEFAULT_MONTHLY_USD = 20;

export interface StartInput {
  url: string;
  domain: string;
  kind: ScanKind;
  budgetMs: number;
  cacheTtlHours: number;
}

export interface StartedScan {
  scanId: string;
  demo: boolean;
  /** يكتمل حين يُخزَّن الفحص ويُسجَّل إنفاقه. لا يُرفض. */
  settled: Promise<void>;
}

export interface ScanPostDeps {
  store: KeyValueStore;
  start(input: StartInput): StartedScan;
  /** `after()` في الإنتاج: يُبقي الدالة حيّة حتى يُخزَّن الفحص. */
  schedule(task: Promise<void>): void;
  env(name: string): string | undefined;
  now(): Date;
  /** Turnstile. غيابُه يعني أن التحقّق غير مُعدّ — لا أنه نجح. */
  verifyHuman?: HumanVerifier | null;
}

/** عنوان الزائر من ترويسات الوكيل العكسي. */
function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '0.0.0.0';
}

function envInt(env: ScanPostDeps['env'], name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** الفحص الوحيد المكشوف للعموم. الكامل يمرّ من مسارٍ آخر حين يُبنى. */
const PUBLIC_KIND: ScanKind = 'quick';

export async function handleScanPost(req: Request, deps: ScanPostDeps): Promise<Response> {
  let body: { url?: unknown; turnstileToken?: unknown };
  try {
    body = (await req.json()) as { url?: unknown; turnstileToken?: unknown };
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof body.url !== 'string') {
    return Response.json({ error: 'url_required' }, { status: 400 });
  }

  let domain: string;
  try {
    domain = normalizeUrl(body.url).hostname.replace(/^www\./, '');
  } catch (err) {
    return Response.json(
      { error: 'invalid_url', detail: isWakeelError(err) ? err.code : undefined },
      { status: 400 }
    );
  }

  const ip = clientIp(req);

  // إثبات الإنسان قبل كلّ شيء آخر: برنامجٌ يُرفض هنا لا يحرق رصيد زائرٍ
  // حقيقيّ يشاركه العنوان، ولا يصل إلى الكاش ولا إلى السقف.
  if (deps.verifyHuman !== undefined && deps.verifyHuman !== null) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined;

    let check: Awaited<ReturnType<HumanVerifier>>;
    try {
      check = await deps.verifyHuman(token, ip);
    } catch (err) {
      // تعذّر التحقّق يُغلق الباب كما يُغلقه المخزن الساقط.
      if (err instanceof VerificationUnavailableError) {
        return Response.json({ error: 'verification_unavailable' }, { status: 503 });
      }
      throw err;
    }

    if (check === 'missing') {
      return Response.json({ error: 'verification_required' }, { status: 403 });
    }
    if (check === 'failed') {
      return Response.json({ error: 'verification_failed' }, { status: 403 });
    }
  }

  const cacheTtlHours = envInt(deps.env, 'CACHE_TTL_HOURS', 24);

  // المخزن الساقط يُغلق الباب ولا يفتحه. لو قُرئ سقوطُه «لا كاش، لا إنفاق،
  // لا رصيد مستهلك» لصار عطلُ Redis دعوةً مفتوحة لحرق الميزانية.
  let decision: Awaited<ReturnType<typeof admit>>;
  try {
    decision = await admit(deps.store, {
      domain,
      kind: PUBLIC_KIND,
      ipHash: hashIp(ip, deps.env('IP_HASH_SALT') ?? 'dev-salt'),
      perIpPerDay: envInt(deps.env, 'FREE_SCANS_PER_IP_PER_DAY', 3),
      maxMonthlyUsd: envInt(deps.env, 'MAX_MONTHLY_SPEND_USD', DEFAULT_MONTHLY_USD),
      cacheTtlHours,
      now: deps.now(),
    });
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      return Response.json({ error: 'store_unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (decision.reason === 'cached') {
    return Response.json({ scanId: decision.scanId, cached: true }, { status: 200 });
  }
  if (decision.reason === 'rate_limited') {
    return Response.json({ error: 'rate_limited', rate: decision.rate }, { status: 429 });
  }
  if (decision.reason === 'budget_exceeded') {
    return Response.json({ error: 'budget_exceeded' }, { status: 503 });
  }

  const { scanId, demo, settled } = deps.start({
    url: body.url,
    domain,
    kind: PUBLIC_KIND,
    budgetMs: SOFT_BUDGET_MS,
    cacheTtlHours,
  });

  // الردّ يعود فوراً، والفحص يكمل خلفه — مضموناً لا متروكاً للحظّ.
  deps.schedule(settled);

  return Response.json({ scanId, cached: false, demo }, { status: 202 });
}
