import { NextResponse, type NextRequest } from 'next/server';
import { normalizeUrl } from '@wakeelcheck/fetcher';
import { isWakeelError } from '@wakeelcheck/core';
import { admit, hashIp } from '@wakeelcheck/limits';
import { limitStore, startScan } from '@/lib/scans';

/** يقرأ عنوان الزائر من ترويسات الوكيل العكسي. */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function POST(req: NextRequest) {
  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof body.url !== 'string') {
    return NextResponse.json({ error: 'url_required' }, { status: 400 });
  }

  let domain: string;
  try {
    domain = normalizeUrl(body.url).hostname.replace(/^www\./, '');
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_url', detail: isWakeelError(err) ? err.code : undefined },
      { status: 400 }
    );
  }

  // الكاش ثم الميزانية ثم رصيد الزائر — القاعدة الملزمة رقم 04.
  const decision = await admit(limitStore, {
    domain,
    kind: 'quick',
    ipHash: hashIp(clientIp(req), process.env['IP_HASH_SALT'] ?? 'dev-salt'),
    perIpPerDay: envInt('FREE_SCANS_PER_IP_PER_DAY', 3),
    maxMonthlyUsd: envInt('MAX_MONTHLY_SPEND_USD', 300),
    cacheTtlHours: envInt('CACHE_TTL_HOURS', 24),
    now: new Date(),
  });

  if (decision.reason === 'cached') {
    return NextResponse.json({ scanId: decision.scanId, cached: true }, { status: 200 });
  }
  if (decision.reason === 'rate_limited') {
    return NextResponse.json({ error: 'rate_limited', rate: decision.rate }, { status: 429 });
  }
  if (decision.reason === 'budget_exceeded') {
    return NextResponse.json({ error: 'budget_exceeded' }, { status: 503 });
  }

  const { scanId, demo } = startScan(body.url, 'quick');
  return NextResponse.json({ scanId, cached: false, demo }, { status: 202 });
}
