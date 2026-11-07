import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'وكيل تشيك — كُن أنت الجواب',
  description:
    'عميلك يسأل الذكاء الاصطناعي. اكتشف هل يوصي بمتجرك، ومن يظهر بدلاً منك — الإجابة الحرفية من ChatGPT وGoogle AI Mode.',
  icons: { icon: '/brand/mark.svg' },
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
