/**
 * المهمّة المجدولة ومسار التسجيل — منطقهما بلا Next.
 *
 * كلاهما يُنفق مالاً أو يفتح باباً للإنفاق، فكلاهما **مغلقٌ ما لم يُضبط سرّه**:
 * غيابُ `CRON_SECRET` أو `ADMIN_TOKEN` يعني أن المسار لا يعمل لأحد، لا أنه
 * يعمل للجميع.
 *
 * والمقارنة بزمنٍ ثابت: مقارنةٌ تتوقّف عند أوّل حرفٍ مختلف تُسرّب طول ما
 * تطابق، فيُخمَّن السرّ حرفاً حرفاً.
 */

import { timingSafeEqual } from 'node:crypto';
import { isWakeelError } from '@wakeelcheck/core';
import { ArchiveUnavailableError, type Monitor, type MonitorRegistry } from '@wakeelcheck/db';
import { normalizeUrl } from '@wakeelcheck/fetcher';
import type { MonitorOutcome } from './monitor';

/** أسبوع: ما تَعِد به المتابعة. */
export const MONITOR_INTERVAL_DAYS = 7;

function authorized(req: Request, secret: string): boolean {
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── المهمّة المجدولة ─────────────────────────────────────────

export interface CronDeps {
  /** `CRON_SECRET` — Vercel يرسله في ترويسة `Authorization` من تلقاء نفسه. */
  secret: string | undefined;
  registry: MonitorRegistry | null;
  runOne(monitor: Monitor): Promise<MonitorOutcome>;
  now(): Date;
}

/**
 * متجرٌ واحد في كلّ استدعاء — الأقدم استحقاقاً.
 *
 * القياس الواحد عشرات الثواني، ومهلة الدالة ستّون. واحدٌ يدخلها بهامش؛
 * اثنان لا. فالسعة تُضبط بتكرار الجدولة لا بحشو الاستدعاء.
 */
export async function handleMonitorCron(req: Request, deps: CronDeps): Promise<Response> {
  if (deps.secret === undefined || deps.secret === '') {
    return Response.json({ error: 'cron_disabled' }, { status: 503 });
  }
  if (!authorized(req, deps.secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (deps.registry === null) {
    return Response.json({ error: 'monitoring_unavailable' }, { status: 503 });
  }

  let due: Monitor[];
  try {
    due = await deps.registry.due(deps.now(), MONITOR_INTERVAL_DAYS, 1);
  } catch (err) {
    if (err instanceof ArchiveUnavailableError) {
      return Response.json({ error: 'monitoring_unavailable' }, { status: 503 });
    }
    throw err;
  }

  const [next] = due;
  if (next === undefined) return Response.json({ ran: null });

  const outcome = await deps.runOne(next);
  return Response.json(
    outcome.status === 'measured'
      ? { ran: outcome.domain, status: outcome.status, report: outcome.reportId, tone: outcome.digest.tone }
      : { ran: outcome.domain, status: outcome.status, report: outcome.reportId }
  );
}

// ── التسجيل ──────────────────────────────────────────────────

export interface EnrollDeps {
  /** `ADMIN_TOKEN`. */
  token: string | undefined;
  registry: MonitorRegistry | null;
  now(): Date;
}

/** يسجّل متجراً للمتابعة. للرئيس وحده، إلى أن يُقرَّر كيف يشترك التاجر. */
export async function handleEnroll(req: Request, deps: EnrollDeps): Promise<Response> {
  if (deps.token === undefined || deps.token === '') {
    return Response.json({ error: 'admin_disabled' }, { status: 503 });
  }
  if (!authorized(req, deps.token)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (deps.registry === null) {
    return Response.json({ error: 'monitoring_unavailable' }, { status: 503 });
  }

  let body: { url?: unknown; locale?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (typeof body.url !== 'string') {
    return Response.json({ error: 'url_required' }, { status: 400 });
  }

  let url: URL;
  try {
    url = normalizeUrl(body.url);
  } catch (err) {
    return Response.json(
      { error: 'invalid_url', detail: isWakeelError(err) ? err.code : undefined },
      { status: 400 }
    );
  }

  const domain = url.hostname.replace(/^www\./, '');
  const locale = body.locale === 'en' ? 'en' : 'ar';

  try {
    await deps.registry.enroll({ domain, url: url.toString(), locale, at: deps.now() });
  } catch (err) {
    if (err instanceof ArchiveUnavailableError) {
      return Response.json({ error: 'monitoring_unavailable' }, { status: 503 });
    }
    throw err;
  }

  return Response.json({ enrolled: domain }, { status: 201 });
}
