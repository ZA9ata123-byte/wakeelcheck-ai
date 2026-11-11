import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../globals.css';
import { PAGES, SEO_DESCRIPTION, SITE, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'AITCHEK — Be the answer.',
  description: SEO_DESCRIPTION.en,
  alternates: alternatesFor(PAGES[0]!, 'en'),
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/brand/mark.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AITCHEK — Be the answer.',
    description: SEO_DESCRIPTION.en,
    images: ['/brand/og-en.png'],
  },
  // رموز التحقّق عامّةٌ بطبيعتها: تُقرأ من رأس الصفحة.
  verification: {
    google: 'NuWMaixoCXbIJwpkLKobKgaghjzxfX99VkrlRMwj1cI',
    // Bing Webmaster Tools — وعبره Copilot، وما يستند إليه بحث ChatGPT.
    other: { 'msvalidate.01': '659E9AC7BB6FFE9AA8F741A0315B2A28' },
  },
  openGraph: {
    type: 'website',
    siteName: 'WakeelCheck',
    locale: 'en_US',
    title: 'AITCHEK — Be the answer.',
    description: SEO_DESCRIPTION.en,
    url: alternatesFor(PAGES[0]!, 'en').canonical,
    images: [{ url: '/brand/og-en.png', width: 1200, height: 630, alt: 'AITCHEK — Be the answer. ChatGPT · Google AI Mode' }],
  },
};

/** Independent root layout for English — see the Arabic layout for why. */
export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#070b13" />
        {/* الوضع والحركة المحفوظان قبل الرسم — بلا وميض. الداكن افتراضيّ كما في الحزمة. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;d.dataset.theme=localStorage.getItem('aitchek-theme')==='light'?'light':'dark';if(localStorage.getItem('aitchek-motion')==='reduce')d.classList.add('reduce-motion')}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        {/* زيارات بلا ملفات تعريف — لا موافقة مطلوبة ولا بيانات شخصية. */}
        <Analytics />
      </body>
    </html>
  );
}
