import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'وكيل تشيك — الخصوصية', alternates: alternatesFor({ ar: '/privacy', en: '/en/privacy' }, 'ar') };

export default function Page() {
  return <Legal locale="ar" kind="privacy" />;
}
