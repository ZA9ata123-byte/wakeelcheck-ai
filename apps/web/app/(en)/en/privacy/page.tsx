import type { Metadata } from 'next';
import Legal from '@/components/Legal';

export const metadata: Metadata = { title: 'AITCHEK — Privacy' };

export default function Page() {
  return <Legal locale="en" kind="privacy" />;
}
