import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'وكيل تشيك — شوف الجواب الذي يعطيه الذكاء الاصطناعي عن متجرك',
  description:
    'نُريك الإجابة الحرفية التي يعطيها ChatGPT وبحث Google عن متجرك، ومن ذُكر بدلاً منك — ثم نُصلح السبب.',
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
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
