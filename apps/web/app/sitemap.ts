import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/lib/seo';

/** sitemap.xml — الصفحات القابلة للفهرسة وحدها، بلغتيها. */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(new Date());
}
