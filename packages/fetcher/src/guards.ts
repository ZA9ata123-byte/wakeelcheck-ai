/**
 * حراس الوجهة — منع SSRF.
 *
 * كل جلب في المنصة يمرّ من هنا. الفحص يستقبل رابطاً يكتبه أي زائر،
 * فبلا هذه الحراسة يصير الخادم وكيلاً مفتوحاً يقرأ الشبكة الداخلية
 * وخدمات بيانات السحابة الوصفية نيابةً عن مهاجم.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { BlockedHostError } from '@wakeelcheck/core';

/** نطاقات IPv4 غير قابلة للتوجيه علناً، أو محجوزة. */
const BLOCKED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8], // هذه الشبكة
  ['10.0.0.0', 8], // خاصة
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — يشمل 169.254.169.254 (بيانات السحابة الوصفية)
  ['172.16.0.0', 12], // خاصة
  ['192.0.0.0', 24], // تخصيصات IETF
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // خاصة
  ['198.18.0.0', 15], // قياس أداء
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // محجوزة — يشمل 255.255.255.255
];

/** أسماء مضيفين تُرفض قبل أي استعلام DNS. */
const BLOCKED_SUFFIXES: readonly string[] = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inV4Cidr(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;

  // مع /0 تكون الإزاحة 32 وهي غير معرَّفة في JS، لكن /0 غير مستعمل هنا.
  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (baseInt & mask) >>> 0;
}

/** يوسّع عنوان IPv6 إلى ثمانية hextets كاملة. */
function expandV6(ip: string): number[] | null {
  let address = ip;

  // IPv4-mapped أو NAT64: ::ffff:1.2.3.4
  const embedded = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const v4 = ipv4ToInt(embedded[2] as string);
    if (v4 === null) return null;
    const hi = (v4 >>> 16).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    address = `${embedded[1] as string}${hi}:${lo}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? (halves[0] as string).split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? (halves[1] as string).split(':').filter(Boolean) : [];

  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (fill < 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(Number.parseInt(group, 16));
  }
  return out;
}

function isBlockedV6(ip: string): boolean {
  const groups = expandV6(ip);
  if (groups === null) return true; // ما لا نفهمه، نرفضه

  const [g0 = 0, g1 = 0, g5 = 0, g6 = 0, g7 = 0] = [
    groups[0],
    groups[1],
    groups[5],
    groups[6],
    groups[7],
  ];

  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7  ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  if (g0 === 0x2002) return true; // 2002::/16 6to4 — قد يغلّف عنواناً خاصاً

  // IPv4-mapped ::ffff:a.b.c.d و NAT64 64:ff9b::/96 — نفحص الـIPv4 المضمَّن
  const mapped = groups.slice(0, 5).every((g) => g === 0) && g5 === 0xffff;
  const nat64 = g0 === 0x0064 && g1 === 0xff9b;
  if (mapped || nat64) {
    const v4Int = ((g6 << 16) >>> 0) + g7;
    return isBlockedV4Int(v4Int);
  }

  return false;
}

function isBlockedV4Int(ipInt: number): boolean {
  return BLOCKED_V4.some(([base, prefix]) => inV4Cidr(ipInt, base, prefix));
}

/** هل هذا العنوان داخلي أو محجوز؟ يقبل IPv4 و IPv6. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const asInt = ipv4ToInt(ip);
    return asInt === null ? true : isBlockedV4Int(asInt);
  }

  if (version === 6) return isBlockedV6(ip);

  return true; // ليس عنواناً صالحاً
}

/** هل الاسم من الأسماء المحلية التي تُرفض قبل DNS؟ */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_SUFFIXES.some(
    (suffix) => (suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix)
  );
}

/**
 * يرفض المضيف إذا كان محلياً، أو كان عنواناً داخلياً، أو حلّ إلى عنوان داخلي.
 * يفحص **كل** العناوين المُعادة — يكفي واحد داخلي للرفض.
 *
 * ملاحظة أمنية معروفة: بين هذا الفحص وبين استعلام DNS الذي يجريه `fetch`
 * توجد فجوة زمنية تسمح نظرياً بإعادة ربط DNS. الإغلاق الكامل يحتاج تثبيت
 * الـIP على مستوى الاتصال (dispatcher مخصّص) — مُدرج في خطة التقوية.
 */
export async function assertPublicHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, ''); // IPv6 بين قوسين في الروابط

  if (host.length === 0) {
    throw new BlockedHostError(hostname, 'empty hostname');
  }

  if (isBlockedHostname(host)) {
    throw new BlockedHostError(host, 'local or reserved hostname');
  }

  // عنوان مكتوب مباشرةً في الرابط — لا حاجة لاستعلام DNS
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      throw new BlockedHostError(host, 'literal private or reserved IP');
    }
    return [host];
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedHostError(host, 'DNS resolution failed');
  }

  if (records.length === 0) {
    throw new BlockedHostError(host, 'no DNS records');
  }

  for (const { address } of records) {
    if (isPrivateIp(address)) {
      throw new BlockedHostError(host, `resolves to private address ${address}`);
    }
  }

  return records.map((r) => r.address);
}
