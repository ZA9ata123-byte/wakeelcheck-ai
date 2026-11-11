import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'AITCHEK — Refunds', alternates: alternatesFor({ ar: '/refund', en: '/en/refund' }, 'en') };

export default function Page() {
  return <Legal locale="en" kind="refund" />;
}
