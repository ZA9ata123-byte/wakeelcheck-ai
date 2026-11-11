import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'وكيل تشيك — الشروط', alternates: alternatesFor({ ar: '/terms', en: '/en/terms' }, 'ar') };

export default function Page() {
  return <Legal locale="ar" kind="terms" />;
}
