import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'AITCHEK — Be the answer.',
  description:
    'Your customer is asking AI. Discover if it recommends your store, and who shows up instead — the verbatim answer from ChatGPT and Google AI Mode.',
  icons: { icon: '/brand/mark.svg' },
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
