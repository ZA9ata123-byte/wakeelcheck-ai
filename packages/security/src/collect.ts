/**
 * جمع بيانات الفحص الأمني من الشبكة.
 *
 * البنية مقصودة: كل ما يمكن تحليله دالة خالصة مُصدَّرة ومُختبَرة، والشبكة
 * غلاف رقيق فوقها. الأخطاء الحقيقية في هذا النوع من الكود تسكن في التحليل
 * لا في الاتصال — شكل ردّ RDAP، وصور سجلّات TXT، وترتيب حقول الشهادة.
 *
 * لا شيء هنا يتجاوز ما يفعله متصفح عادي أو استعلام عام يستطيعه أي أحد.
 */

import { promises as dns } from 'node:dns';
import { connect as tlsConnect } from 'node:tls';
import { assertPublicHost, safeFetch } from '@wakeelcheck/fetcher';
import type { CertInfo, DomainInfo, JsAsset, MailAuth } from './evaluate.ts';

// ── RDAP: انتهاء النطاق ──────────────────────────────────────

/** أحداث RDAP التي تدلّ على انتهاء التسجيل. */
const EXPIRY_EVENTS = new Set(['expiration', 'registrar expiration']);

interface RdapEvent {
  eventAction?: unknown;
  eventDate?: unknown;
}

/**
 * يستخرج تاريخ الانتهاء من ردّ RDAP.
 *
 * السجلات تختلف في تسمية الحدث، وبعضها يُعيد أحداثاً بلا تاريخ. أي شيء
 * غير مفهوم يُعاد كـ null: نطاق بلا تاريخ خير من تاريخ مخترع.
 */
export function parseRdapExpiry(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;

  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;

  for (const raw of events as RdapEvent[]) {
    const action = typeof raw?.eventAction === 'string' ? raw.eventAction.toLowerCase() : '';
    if (!EXPIRY_EVENTS.has(action)) continue;

    if (typeof raw.eventDate !== 'string') continue;
    const parsed = new Date(raw.eventDate);
    if (Number.isNaN(parsed.getTime())) continue;

    return parsed.toISOString();
  }

  return null;
}

// ── DNS: مصادقة البريد ──────────────────────────────────────

/** سجلّات TXT تعود مقسّمة إلى شرائح بحد 255 محرفاً — تُوصل قبل القراءة. */
export function joinTxt(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(''));
}

export function pickSpf(records: string[][]): string | null {
  return joinTxt(records).find((r) => /^v=spf1\b/i.test(r.trim())) ?? null;
}

export function pickDmarc(records: string[][]): string | null {
  return joinTxt(records).find((r) => /^v=DMARC1\b/i.test(r.trim())) ?? null;
}

// ── ملفات JS العامة ─────────────────────────────────────────

/**
 * يجمع روابط سكربتات الصفحة — نفس ما يحمّله كل زائر.
 *
 * ملفات النطاق نفسه أولاً: مفتاح التاجر المسرّب يكون في حزمته هو، لا في
 * سكربت تحليلات من طرف ثالث.
 */
export function findScriptUrls(html: string, baseUrl: string, limit = 8): string[] {
  const own: string[] = [];
  const third: string[] = [];
  const seen = new Set<string>();

  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return [];
  }

  for (const match of html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (raw === undefined) continue;

    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;

      const href = url.toString();
      if (seen.has(href)) continue;
      seen.add(href);

      (url.hostname === host ? own : third).push(href);
    } catch {
      // رابط معطوب
    }
  }

  return [...own, ...third].slice(0, limit);
}

// ── الشهادة ─────────────────────────────────────────────────

export interface PeerCertificate {
  valid_to?: string;
}

export function certInfoFrom(peer: PeerCertificate, protocol: string | null): CertInfo {
  const raw = peer.valid_to;
  if (typeof raw !== 'string') return { expiresAt: null, protocol };

  const parsed = new Date(raw);
  return {
    expiresAt: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(),
    protocol,
  };
}

// ── المحوّلات ────────────────────────────────────────────────

const RDAP_BASE = 'https://rdap.org/domain/';

export async function fetchDomainInfo(domain: string): Promise<DomainInfo> {
  try {
    const res = await safeFetch(`${RDAP_BASE}${encodeURIComponent(domain)}`, {
      timeoutMs: 8_000,
      maxBytes: 500_000,
      headers: { Accept: 'application/rdap+json' },
    });
    if (res.status !== 200) return { expiresAt: null };

    return { expiresAt: parseRdapExpiry(JSON.parse(res.body)) };
  } catch {
    return { expiresAt: null };
  }
}

export async function fetchCert(domain: string, timeoutMs = 8_000): Promise<CertInfo> {
  // نفس حارس SSRF المطبَّق على الجلب: tls.connect إلى مضيف داخلي
  // ثغرة بعينها وإن لم تكن fetch.
  try {
    await assertPublicHost(domain);
  } catch {
    return { expiresAt: null, protocol: null };
  }

  return new Promise<CertInfo>((resolve) => {
    const done = (info: CertInfo): void => {
      socket.destroy();
      resolve(info);
    };

    const socket = tlsConnect(
      { host: domain, port: 443, servername: domain, rejectUnauthorized: false },
      () => {
        done(certInfoFrom(socket.getPeerCertificate(), socket.getProtocol()));
      }
    );

    socket.setTimeout(timeoutMs, () => done({ expiresAt: null, protocol: null }));
    socket.on('error', () => done({ expiresAt: null, protocol: null }));
  });
}

export async function fetchMailAuth(domain: string): Promise<MailAuth> {
  const [root, dmarc] = await Promise.allSettled([
    dns.resolveTxt(domain),
    dns.resolveTxt(`_dmarc.${domain}`),
  ]);

  return {
    spf: root.status === 'fulfilled' ? pickSpf(root.value) : null,
    dmarc: dmarc.status === 'fulfilled' ? pickDmarc(dmarc.value) : null,
  };
}

/** النطاقات الفرعية الشائعة التي يتركها التجار خلفهم. */
const COMMON_SUBDOMAINS = ['www', 'shop', 'store', 'blog', 'old', 'staging', 'app', 'mail'];

/**
 * يبحث عن CNAME يشير إلى خدمة لم تعد موجودة.
 *
 * قائمة ثابتة وقصيرة، لا تخمين عشوائي: استعلام DNS عن اسم معروف فحص
 * سلبي، أما توليد آلاف الأسماء فهو مسح — وهو ما لا نفعله.
 */
export async function findDanglingCnames(domain: string): Promise<string[]> {
  const checks = COMMON_SUBDOMAINS.map(async (label) => {
    const host = `${label}.${domain}`;

    let target: string[];
    try {
      target = await dns.resolveCname(host);
    } catch {
      return null; // لا CNAME إطلاقاً — ليس تعليقاً
    }
    if (target.length === 0) return null;

    try {
      await dns.resolve4(host);
      return null; // يحلّ إلى عنوان — سليم
    } catch {
      return host; // له CNAME لكنه لا يحلّ إلى شيء
    }
  });

  return (await Promise.all(checks)).filter((host): host is string => host !== null);
}

export async function fetchJsAssets(
  html: string,
  baseUrl: string,
  limit = 8
): Promise<JsAsset[]> {
  const urls = findScriptUrls(html, baseUrl, limit);

  const loaded = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await safeFetch(url, { timeoutMs: 6_000, maxBytes: 1_500_000 });
        return res.status === 200 ? { url, text: res.body } : null;
      } catch {
        return null;
      }
    })
  );

  return loaded.filter((asset): asset is JsAsset => asset !== null);
}

// ── التجميع ──────────────────────────────────────────────────

export interface CollectedSecurity {
  domainInfo: DomainInfo;
  cert: CertInfo;
  mail: MailAuth;
  jsAssets: JsAsset[];
  danglingCnames: string[];
}

/**
 * يجمع كل ما يحتاجه التقييم، بالتوازي.
 *
 * كل مصدر يسقط وحده: RDAP محجوب أو DNS بطيء لا يمنع بقية الفحص. الغائب
 * يعود فارغاً، والتقييم لا يُنتج نتيجة عمّا لا يعرفه.
 */
export async function collectSecurity(
  domain: string,
  html: string,
  baseUrl: string
): Promise<CollectedSecurity> {
  const [domainInfo, cert, mail, jsAssets, danglingCnames] = await Promise.all([
    fetchDomainInfo(domain),
    fetchCert(domain),
    fetchMailAuth(domain),
    fetchJsAssets(html, baseUrl),
    findDanglingCnames(domain).catch(() => []),
  ]);

  return { domainInfo, cert, mail, jsAssets, danglingCnames };
}
