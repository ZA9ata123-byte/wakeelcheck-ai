import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { PAGES, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'AITCHEK — Refunds', alternates: alternatesFor(PAGES[3]!, 'en') };

export default function Page() {
  return <Legal locale="en" kind="refund" />;
}
