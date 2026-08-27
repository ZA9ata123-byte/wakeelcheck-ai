/**
 * استخراج JSON-LD والوسوم من صفحة.
 *
 * الاستخراج يتعامل مع `@graph` والمصفوفات والكائنات المتداخلة، لأن سلة
 * وShopify تُخرج أشكالاً مختلفة لنفس البيانات.
 */

import * as cheerio from 'cheerio';
import type { PageSnapshot } from './context.ts';

export interface JsonLdNode {
  types: string[];
  raw: Record<string, unknown>;
}

export interface PageFacts {
  jsonLd: JsonLdNode[];
  /** كل الأنواع الموجودة في الصفحة بحروف صغيرة. */
  types: Set<string>;
  meta: Record<string, string>;
  h1Count: number;
  mainCount: number;
  imageCount: number;
  imagesWithAlt: number;
  /** أول سعر مُعلن في كل طبقة — لفحص الاتساق. */
  price: { schema: string | null; openGraph: string | null; microdata: string | null };
  currency: { schema: string | null; openGraph: string | null };
  availability: { schema: string | null; openGraph: string | null };
}

function collectNodes(value: unknown, out: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const node = value as Record<string, unknown>;
  const rawType = node['@type'];

  if (rawType !== undefined) {
    const types = (Array.isArray(rawType) ? rawType : [rawType])
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase());
    if (types.length > 0) out.push({ types, raw: node });
  }

  for (const nested of Object.values(node)) collectNodes(nested, out);
}

/** يبحث في شجرة JSON-LD عن أول قيمة لمفتاح ضمن نوع معيّن. */
function findIn(nodes: JsonLdNode[], type: string, key: string): string | null {
  for (const node of nodes) {
    if (!node.types.includes(type)) continue;
    const value = node.raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/** ينزع البادئة الكاملة من قيم schema.org: "https://schema.org/InStock" → "instock". */
export function shortenSchemaValue(value: string | null): string | null {
  if (value === null) return null;
  const tail = value.split('/').pop() ?? value;
  return tail.toLowerCase();
}

export function readPage(page: PageSnapshot): PageFacts {
  const $ = cheerio.load(page.html || '<html></html>');

  const nodes: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length === 0) return;
    try {
      collectNodes(JSON.parse(text), nodes);
    } catch {
      // JSON-LD معطوب — نتجاهله ولا نُسقط الفحص كله
    }
  });

  const meta: Record<string, string> = {};
  $('meta').each((_i, el) => {
    const name = $(el).attr('property') ?? $(el).attr('name');
    const content = $(el).attr('content');
    if (name && content) meta[name.toLowerCase()] = content;
  });

  const images = $('img');
  let withAlt = 0;
  images.each((_i, el) => {
    const alt = $(el).attr('alt');
    if (alt !== undefined && alt.trim().length > 0) withAlt++;
  });

  // Offer قد يكون داخل Product أو منفصلاً — نبحث في كليهما.
  const offerPrice = findIn(nodes, 'offer', 'price') ?? findIn(nodes, 'aggregateoffer', 'lowPrice');
  const offerCurrency =
    findIn(nodes, 'offer', 'priceCurrency') ?? findIn(nodes, 'aggregateoffer', 'priceCurrency');
  const offerAvailability = findIn(nodes, 'offer', 'availability');

  return {
    jsonLd: nodes,
    types: new Set(nodes.flatMap((n) => n.types)),
    meta,
    h1Count: $('h1').length,
    mainCount: $('main').length,
    imageCount: images.length,
    imagesWithAlt: withAlt,
    price: {
      schema: offerPrice,
      openGraph: meta['product:price:amount'] ?? meta['og:price:amount'] ?? null,
      microdata: $('[itemprop="price"]').first().attr('content') ?? null,
    },
    currency: {
      schema: offerCurrency,
      openGraph: meta['product:price:currency'] ?? meta['og:price:currency'] ?? null,
    },
    availability: {
      schema: shortenSchemaValue(offerAvailability),
      openGraph: shortenSchemaValue(
        meta['product:availability'] ?? meta['og:availability'] ?? null
      ),
    },
  };
}

/** يقارن سعرين نصّيين رقمياً: "199.00" و "199" متساويان. */
export function samePrice(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true; // غياب أحدهما ليس تناقضاً

  const parse = (v: string): number => Number.parseFloat(v.replace(/[^\d.]/g, ''));
  const left = parse(a);
  const right = parse(b);

  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(left - right) < 0.01;
}
