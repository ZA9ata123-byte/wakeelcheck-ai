import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'AITCHEK — Privacy', alternates: alternatesFor({ ar: '/privacy', en: '/en/privacy' }, 'en') };

export default function Page() {
  return <Legal locale="en" kind="privacy" />;
}
