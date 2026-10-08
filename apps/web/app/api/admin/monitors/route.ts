import { handleEnroll } from '@/lib/cron';
import { monitors } from '@/lib/scans';

/** يسجّل متجراً للمتابعة. المنطق في `lib/cron.ts` ويُختبر هناك. */
export function POST(req: Request): Promise<Response> {
  return handleEnroll(req, {
    token: process.env['ADMIN_TOKEN'],
    registry: monitors,
    now: () => new Date(),
  });
}
