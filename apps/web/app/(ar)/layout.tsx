import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../globals.css';
import { PAGES, SEO_DESCRIPTION, SITE, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'وكيل تشيك — كُن أنت الجواب',
  description: SEO_DESCRIPTION.ar,
  alternates: alternatesFor(PAGES[0]!, 'ar'),
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/brand/mark.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'وكيل تشيك — كُن أنت الجواب',
    description: SEO_DESCRIPTION.ar,
    images: ['/brand/og-ar.png'],
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
    locale: 'ar_AR',
    title: 'وكيل تشيك — كُن أنت الجواب',
    description: SEO_DESCRIPTION.ar,
    url: alternatesFor(PAGES[0]!, 'ar').canonical,
    images: [{ url: '/brand/og-ar.png', width: 1200, height: 630, alt: 'وكيل تشيك — كُن أنت الجواب. ChatGPT · Google AI Mode' }],
  },
};

/**
 * تخطيط جذري مستقل للعربية.
 *
 * لغة الصفحة واتجاهها يُكتبان على وسم html نفسه، وNext لا يمرّر معلومات
 * المسار إلى تخطيط جذري واحد. لذلك مجموعتا مسارات، لكل واحدة جذرها —
 * وهو النمط الموثّق لتعدّد اللغات.
 */
export default function ArabicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-theme="dark" suppressHydrationWarning>
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
