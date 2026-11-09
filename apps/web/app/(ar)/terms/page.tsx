import type { Metadata } from 'next';
import Legal from '@/components/Legal';

export const metadata: Metadata = { title: 'وكيل تشيك — الشروط' };

export default function Page() {
  return <Legal locale="ar" kind="terms" />;
}
