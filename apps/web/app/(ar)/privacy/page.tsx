import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { PAGES, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'وكيل تشيك — الخصوصية', alternates: alternatesFor(PAGES[2]!, 'ar') };

export default function Page() {
  return <Legal locale="ar" kind="privacy" />;
}
