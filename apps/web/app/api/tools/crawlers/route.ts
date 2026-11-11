import { safeFetch } from '@wakeelcheck/fetcher';
import { handleCrawlerCheck } from '@/lib/crawler-check';
import { store } from '@/lib/scans';

/** فاحص زواحف الذكاء الاصطناعي. المنطق في `lib/crawler-check.ts` ويُختبر هناك. */
export function GET(req: Request): Promise<Response> {
  return handleCrawlerCheck(req, {
    fetch: (url, opts) => safeFetch(url, opts),
    store,
    salt: process.env['IP_HASH_SALT'] ?? 'dev-salt',
  });
}
