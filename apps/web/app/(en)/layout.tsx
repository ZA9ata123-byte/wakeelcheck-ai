import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'WakeelCheck — see the answer AI gives about your store',
  description:
    'See the exact answer ChatGPT and Google AI give about your store, and who gets named instead of you.',
};

/** Independent root layout for English — see the Arabic layout for why. */
export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
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
