import type { Metadata } from 'next';
import CrawlerTool from '@/components/CrawlerTool';
import { SiteFooter, SiteHeader } from '@/components/Chrome';
import { SITE, alternatesFor } from '@/lib/seo';

const TITLE = 'فاحص زواحف الذكاء الاصطناعي — هل يقرأ ChatGPT وGoogle متجرك؟';
const DESC = 'أداة مجانية بلا تسجيل: اكتب نطاق متجرك لنقرأ robots.txt ونقول لك أيّ زواحف الذكاء الاصطناعي مسموحة وأيّها محظورة، وأيّها للبحث المباشر وأيّها للتدريب.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: alternatesFor({ ar: '/tools/ai-crawlers', en: '/en/tools/ai-crawlers' }, 'ar'),
  openGraph: { title: TITLE, description: DESC, url: `${SITE}/tools/ai-crawlers`, images: [{ url: '/brand/og-ar.png', width: 1200, height: 630 }] },
};

const LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: TITLE,
  url: `${SITE}/tools/ai-crawlers`,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  inLanguage: 'ar',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'WakeelCheck', url: SITE },
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD).replace(/</g, '\\u003c') }} />
      <SiteHeader lang="ar" other="/en/tools/ai-crawlers" />
      <main id="main" className="container legal-page guide-page">
        <span className="eyebrow">AITCHEK</span>
        <h1>فاحص زواحف الذكاء الاصطناعي</h1>
        <p>اكتب نطاق متجرك، فنقرأ ملف robots.txt المنشور ونقول لك أيّ زواحف ChatGPT وGoogle وClaude وPerplexity وBing تستطيع قراءته. مجاني، بلا تسجيل.</p>
        <CrawlerTool lang="ar" />
        <h2>لماذا يهمّ هذا؟</h2>
        <p>محرّكات الذكاء الاصطناعي لا تذكر متجراً لا تستطيع قراءته. زواحف البحث المباشر (OAI-SearchBot، Googlebot، Bingbot، PerplexityBot، Claude-SearchBot) هي ما يقرّر ظهورك في الإجابات؛ أمّا GPTBot وClaudeBot وGoogle-Extended فللتدريب، ومنعها لا يُخفيك.</p>
        <p>
          <a className="text-button" href="/guides/ai-crawlers-search-vs-training">اقرأ الدليل الكامل: OAI-SearchBot أم GPTBot؟</a>
        </p>
      </main>
      <SiteFooter lang="ar" />
    </>
  );
}
