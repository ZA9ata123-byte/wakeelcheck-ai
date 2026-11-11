import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GuidePage from '@/components/GuidePage';
import { GUIDES, guideBySlug, guidePath } from '@/lib/guides';
import { SITE } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = guideBySlug((await params).slug);
  if (guide === undefined) return {};
  const body = guide.en;
  return {
    title: body.title,
    description: body.description,
    alternates: {
      canonical: `${SITE}${guidePath(guide.slug, 'en')}`,
      languages: {
        ar: `${SITE}${guidePath(guide.slug, 'ar')}`,
        en: `${SITE}${guidePath(guide.slug, 'en')}`,
        'x-default': `${SITE}${guidePath(guide.slug, 'ar')}`,
      },
    },
    openGraph: {
      type: 'article',
      title: body.title,
      description: body.description,
      url: `${SITE}${guidePath(guide.slug, 'en')}`,
      images: [{ url: '/brand/og-en.png', width: 1200, height: 630 }],
    },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const guide = guideBySlug((await params).slug);
  if (guide === undefined) notFound();
  return <GuidePage guide={guide} lang="en" />;
}
