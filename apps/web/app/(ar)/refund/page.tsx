import type { Metadata } from 'next';
import Legal from '@/components/Legal';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = { title: 'وكيل تشيك — الاسترجاع', alternates: alternatesFor({ ar: '/refund', en: '/en/refund' }, 'ar') };

export default function Page() {
  return <Legal locale="ar" kind="refund" />;
}
