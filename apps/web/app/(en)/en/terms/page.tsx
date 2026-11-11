import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'AITCHEK — Terms', alternates: alternatesFor({ ar: '/terms', en: '/en/terms' }, 'en') };

export default function Page() {
  return <Legal locale="en" kind="terms" />;
}
