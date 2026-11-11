import type { Metadata } from 'next';
import { GuidesIndex } from '@/components/GuidePage';
import { GUIDES } from '@/lib/guides';
import { SITE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'أدلة الظهور في إجابات الذكاء الاصطناعي — وكيل تشيك',
  alternates: {
    canonical: `${SITE}/guides`,
    languages: { ar: `${SITE}/guides`, en: `${SITE}/en/guides`, 'x-default': `${SITE}/guides` },
  },
};

export default function Page() {
  return <GuidesIndex lang="ar" guides={GUIDES} />;
}
