import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { PAGES, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'وكيل تشيك — الاسترجاع', alternates: alternatesFor(PAGES[3]!, 'ar') };

export default function Page() {
  return <Legal locale="ar" kind="refund" />;
}
