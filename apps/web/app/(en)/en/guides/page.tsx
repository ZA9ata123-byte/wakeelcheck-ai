import type { Metadata } from 'next';
import { GuidesIndex } from '@/components/GuidePage';
import { GUIDES } from '@/lib/guides';
import { SITE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Guides to appearing in AI answers — AITCHEK',
  alternates: {
    canonical: `${SITE}/en/guides`,
    languages: { ar: `${SITE}/guides`, en: `${SITE}/en/guides`, 'x-default': `${SITE}/guides` },
  },
};

export default function Page() {
  return <GuidesIndex lang="en" guides={GUIDES} />;
}
