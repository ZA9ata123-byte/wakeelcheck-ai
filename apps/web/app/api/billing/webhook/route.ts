import { handleLemonWebhook } from '@/lib/billing';
import { monitors, subscriptions } from '@/lib/scans';

/** إشعارات Lemon Squeezy. المنطق في `lib/billing.ts` ويُختبر هناك. */
export function POST(req: Request): Promise<Response> {
  return handleLemonWebhook(req, {
    secret: process.env['LEMONSQUEEZY_WEBHOOK_SECRET'],
    ledger: subscriptions,
    registry: monitors,
  });
}
