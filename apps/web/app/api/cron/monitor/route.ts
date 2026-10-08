import { handleMonitorCron } from '@/lib/cron';
import { monitorOnce, monitors } from '@/lib/scans';

/** قياسٌ واحد يدخل الدقيقة بهامش — انظر `lib/launch.ts`. */
export const maxDuration = 60;

/**
 * يستدعيه Vercel Cron (`vercel.json`) ويرسل `CRON_SECRET` من تلقاء نفسه.
 * المنطق في `lib/cron.ts` ويُختبر هناك.
 */
export function GET(req: Request): Promise<Response> {
  return handleMonitorCron(req, {
    secret: process.env['CRON_SECRET'],
    registry: monitors,
    runOne: monitorOnce,
    now: () => new Date(),
  });
}
