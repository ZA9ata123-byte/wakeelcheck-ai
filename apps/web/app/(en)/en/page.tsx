import Studio from '@/components/Studio';
import { jsonLd } from '@/lib/seo';

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd('en')).replace(/</g, '\\u003c') }}
      />
      <Studio locale="en" />
    </>
  );
}
