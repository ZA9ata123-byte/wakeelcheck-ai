import type { MetadataRoute } from 'next';
import { robotsRules } from '@/lib/seo';

/** robots.txt — المنطق في `lib/seo.ts` ويُختبر هناك. */
export default function robots(): MetadataRoute.Robots {
  return robotsRules();
}
