import { handleCheckout } from '@/lib/billing';

/** يحوّل التاجر إلى صفحة الدفع. المنطق في `lib/billing.ts` ويُختبر هناك. */
export function GET(req: Request): Response {
  return handleCheckout(req, {
    base: process.env['LEMONSQUEEZY_CHECKOUT_URL'],
    yearly: process.env['LEMONSQUEEZY_CHECKOUT_URL_YEARLY'],
  });
}
