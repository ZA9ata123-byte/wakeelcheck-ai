import type { Metadata } from 'next';
import CrawlerTool from '@/components/CrawlerTool';
import { SiteFooter, SiteHeader } from '@/components/Chrome';
import { SITE, alternatesFor } from '@/lib/seo';

const TITLE = 'AI crawler checker — can ChatGPT and Google read your store?';
const DESC = 'Free, no signup: enter your store domain and we read its robots.txt to tell you which AI crawlers are allowed or blocked, and which are live search versus training.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: alternatesFor({ ar: '/tools/ai-crawlers', en: '/en/tools/ai-crawlers' }, 'en'),
  openGraph: { title: TITLE, description: DESC, url: `${SITE}/en/tools/ai-crawlers`, images: [{ url: '/brand/og-en.png', width: 1200, height: 630 }] },
};

const LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: TITLE,
  url: `${SITE}/en/tools/ai-crawlers`,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  inLanguage: 'en',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'WakeelCheck', url: SITE },
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD).replace(/</g, '\\u003c') }} />
      <SiteHeader lang="en" other="/tools/ai-crawlers" />
      <main id="main" className="container legal-page guide-page">
        <span className="eyebrow">AITCHEK</span>
        <h1>AI crawler checker</h1>
        <p>Enter your store domain and we read its published robots.txt to tell you which ChatGPT, Google, Claude, Perplexity and Bing crawlers can read it. Free, no signup.</p>
        <CrawlerTool lang="en" />
        <h2>Why it matters</h2>
        <p>AI engines do not name a store they cannot read. Live-search crawlers (OAI-SearchBot, Googlebot, Bingbot, PerplexityBot, Claude-SearchBot) decide whether you appear in answers; GPTBot, ClaudeBot and Google-Extended are for training, and blocking them does not hide you.</p>
        <p>
          <a className="text-button" href="/en/guides/ai-crawlers-search-vs-training">Read the full guide: OAI-SearchBot or GPTBot?</a>
        </p>
      </main>
      <SiteFooter lang="en" />
    </>
  );
}
