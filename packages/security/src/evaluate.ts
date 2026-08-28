/**
 * تقييمات الأمان — دوال خالصة.
 *
 * كل دالة هنا تأخذ بيانات مجموعة مسبقاً وتُرجع نتائج. لا شبكة، لا وقت
 * نظام إلا ما يُمرَّر صراحةً. هذا ما يجعل المنطق قابلاً للاختبار بالكامل
 * بلا DNS ولا TLS ولا RDAP — والمحوّلات في `collect.ts` تبقى رقيقة.
 *
 * الفحص سلبي بالكامل: كل ما هنا يفعله متصفح عادي عند زيارة الموقع،
 * أو استعلام عام يستطيع أي أحد إجراؤه. لا مسح منافذ، لا تخمين مسارات.
 */

import type { SecurityFinding, Severity } from '@wakeelcheck/core';
import { findSecrets } from '@wakeelcheck/core';

// ── مدخلات مجمَّعة ────────────────────────────────────────────

export interface DomainInfo {
  /** ISO 8601 من RDAP، أو null إن تعذّر الاستعلام. */
  expiresAt: string | null;
}

export interface CertInfo {
  expiresAt: string | null;
  /** مثل "TLSv1.3". */
  protocol: string | null;
}

export interface MailAuth {
  spf: string | null;
  dmarc: string | null;
}

export interface JsAsset {
  url: string;
  text: string;
}

export interface SecurityInput {
  domain: string;
  /** لحظة التقييم — تُمرَّر صراحةً حتى تكون الاختبارات ثابتة. */
  now: Date;
  domainInfo: DomainInfo;
  cert: CertInfo;
  mail: MailAuth;
  headers: Record<string, string>;
  /** true إن كانت الصفحة تُقدَّم عبر https. */
  https: boolean;
  html: string;
  /** ملفات JS المُقدَّمة علناً — نفس ما يحمّله كل زائر. */
  jsAssets: JsAsset[];
  /** نطاقات فرعية لها CNAME لا يحلّ إلى شيء. */
  danglingCnames: string[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// ── انتهاء النطاق — أقوى إنذار في المنتج ─────────────────────

export function evaluateDomain(input: SecurityInput): SecurityFinding[] {
  const { expiresAt } = input.domainInfo;
  if (expiresAt === null) return [];

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return [];

  const days = daysBetween(input.now, expiry);
  if (days > 60) return [];

  // النطاق كارثة صامتة: خسارته تُطفئ المتجر، وتجديده يستغرق دقيقتين.
  // لذلك يبقى «مرتفعاً» حتى مع شهر ونصف من المهلة — لا يُخفَّض قبل ذلك.
  const severity: Severity =
    days <= 14 ? 'critical' : days <= 45 ? 'high' : 'medium';

  const detail =
    days <= 0
      ? {
          ar: 'انتهى نطاقك بالفعل. متجرك غير متاح، ويستطيع أي شخص شراء اسمك الآن.',
          en: 'Your domain has already expired. Anyone can register your name now.',
        }
      : {
          ar: `إذا لم تُجدّده، يختفي متجرك ويستطيع أي شخص شراء اسمك.`,
          en: `If you do not renew, your store goes offline and the name becomes available.`,
        };

  return [
    {
      kind: 'domain_expiry',
      severity,
      title: {
        ar: days <= 0 ? 'نطاقك منتهٍ' : `نطاقك ينتهي بعد ${days} يوماً`,
        en: days <= 0 ? 'Your domain has expired' : `Your domain expires in ${days} days`,
      },
      detail,
      evidence: `RDAP expiry ${expiry.toISOString().slice(0, 10)} (${days}d)`,
      expiresAt: expiry.toISOString(),
    },
  ];
}

// ── الشهادة ──────────────────────────────────────────────────

export function evaluateCert(input: SecurityInput): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const { expiresAt, protocol } = input.cert;

  if (expiresAt !== null) {
    const expiry = new Date(expiresAt);
    if (!Number.isNaN(expiry.getTime())) {
      const days = daysBetween(input.now, expiry);
      if (days <= 21) {
        out.push({
          kind: 'tls_expiry',
          severity: days <= 0 ? 'critical' : days <= 7 ? 'critical' : 'high',
          title: {
            ar: days <= 0 ? 'شهادة الأمان منتهية' : `شهادة الأمان تنتهي بعد ${days} يوماً`,
            en: days <= 0 ? 'TLS certificate has expired' : `TLS certificate expires in ${days} days`,
          },
          detail: {
            ar: 'متصفح كل زبون سيعرض تحذير «موقع غير آمن» ويمنعه من الشراء.',
            en: 'Every visitor will see a "not secure" warning before they can buy.',
          },
          evidence: `notAfter ${expiry.toISOString().slice(0, 10)} (${days}d)`,
          expiresAt: expiry.toISOString(),
        });
      }
    }
  }

  if (protocol !== null && /TLSv1(\.[01])?$/.test(protocol)) {
    out.push({
      kind: 'tls_expiry',
      severity: 'medium',
      title: { ar: 'بروتوكول تشفير قديم', en: 'Outdated TLS protocol' },
      detail: {
        ar: 'المتصفحات الحديثة ترفض هذا الإصدار تدريجياً.',
        en: 'Modern browsers are phasing this version out.',
      },
      evidence: `negotiated ${protocol}`,
    });
  }

  return out;
}

// ── انتحال البريد — ما يخرج من بال كل تاجر ───────────────────

export function evaluateMail(input: SecurityInput): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const { spf, dmarc } = input.mail;

  if (spf === null) {
    out.push({
      kind: 'no_spf',
      severity: 'medium',
      title: { ar: 'سجل SPF مفقود', en: 'SPF record is missing' },
      detail: {
        ar: 'بلا SPF تُصنَّف رسائلك كمزعجة، وتسهل انتحال نطاقك.',
        en: 'Without SPF your mail lands in spam and your domain is easier to spoof.',
      },
      evidence: 'no v=spf1 TXT record',
    });
  }

  const enforced = dmarc !== null && /p\s*=\s*(quarantine|reject)/i.test(dmarc);

  if (dmarc === null || !enforced) {
    out.push({
      kind: 'no_dmarc',
      severity: dmarc === null ? 'high' : 'medium',
      title: {
        ar: dmarc === null ? 'نطاقك غير محمي من الانتحال' : 'سياسة DMARC غير مفعّلة',
        en: dmarc === null ? 'Your domain is open to spoofing' : 'DMARC policy is not enforcing',
      },
      detail: {
        ar:
          dmarc === null
            ? 'أي شخص يستطيع إرسال بريد باسم متجرك إلى زبائنك.'
            : 'السياسة على "none": الانتحال يُرصد ولا يُمنع.',
        en:
          dmarc === null
            ? 'Anyone can send email that appears to come from your store.'
            : 'Policy is "none": spoofing is observed but not blocked.',
      },
      evidence: dmarc === null ? 'no _dmarc TXT record' : `_dmarc: ${dmarc.slice(0, 80)}`,
    });
  }

  return out;
}

// ── ترويسات الحماية ──────────────────────────────────────────

const HEADER_CHECKS: readonly { header: string; ar: string; en: string; severity: Severity }[] = [
  { header: 'strict-transport-security', ar: 'HSTS', en: 'HSTS', severity: 'medium' },
  { header: 'content-security-policy', ar: 'CSP', en: 'CSP', severity: 'medium' },
  { header: 'x-content-type-options', ar: 'X-Content-Type-Options', en: 'X-Content-Type-Options', severity: 'low' },
  { header: 'referrer-policy', ar: 'Referrer-Policy', en: 'Referrer-Policy', severity: 'low' },
];

export function evaluateHeaders(input: SecurityInput): SecurityFinding[] {
  const missing = HEADER_CHECKS.filter(({ header }) => input.headers[header] === undefined);
  if (missing.length === 0) return [];

  return [
    {
      kind: 'missing_headers',
      severity: missing.some((m) => m.severity === 'medium') ? 'medium' : 'low',
      title: {
        ar: `${missing.length} من ترويسات الحماية مفقودة`,
        en: `${missing.length} security headers are missing`,
      },
      detail: {
        ar: 'ترويسات قياسية تُضاف من إعدادات الخادم وتغلق ثغرات شائعة.',
        en: 'Standard headers set at the server level that close common gaps.',
      },
      evidence: missing.map((m) => m.en).join(', '),
    },
  ];
}

export function evaluateCookies(input: SecurityInput): SecurityFinding[] {
  const raw = input.headers['set-cookie'];
  if (raw === undefined || !input.https) return [];

  const flaws: string[] = [];
  if (!/;\s*Secure/i.test(raw)) flaws.push('Secure');
  if (!/;\s*HttpOnly/i.test(raw)) flaws.push('HttpOnly');
  if (!/;\s*SameSite/i.test(raw)) flaws.push('SameSite');
  if (flaws.length === 0) return [];

  return [
    {
      kind: 'cookie_flags',
      severity: 'medium',
      title: { ar: 'كوكيز بلا أعلام حماية', en: 'Cookies missing protection flags' },
      detail: {
        ar: 'تسهّل اختطاف جلسة الزبون أثناء الشراء.',
        en: 'Makes it easier to hijack a customer session mid-purchase.',
      },
      evidence: `missing: ${flaws.join(', ')}`,
    },
  ];
}

// ── محتوى مختلط ──────────────────────────────────────────────

export function evaluateMixedContent(input: SecurityInput): SecurityFinding[] {
  if (!input.https) return [];

  const matches = input.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) ?? [];
  if (matches.length === 0) return [];

  const first = matches[0] ?? '';
  return [
    {
      kind: 'mixed_content',
      severity: 'medium',
      title: {
        ar: `${matches.length} مورداً يُحمَّل عبر http داخل صفحة https`,
        en: `${matches.length} resources loaded over http inside an https page`,
      },
      detail: {
        ar: 'المتصفح يحجبها أو يعرض تحذيراً، وقد تختفي صور منتجاتك.',
        en: 'Browsers block these or warn, and product images may vanish.',
      },
      evidence: first.slice(0, 90),
    },
  ];
}

// ── الأسرار المكشوفة — الطمس إلزامي ─────────────────────────

export function evaluateSecrets(input: SecurityInput): SecurityFinding[] {
  const out: SecurityFinding[] = [];

  for (const asset of input.jsAssets) {
    for (const hit of findSecrets(asset.text)) {
      const line = asset.text.slice(0, hit.index).split('\n').length;

      out.push({
        kind: 'exposed_secret',
        severity: 'critical',
        title: { ar: 'مفتاح سرّي مكشوف في ملفات متجرك', en: 'A secret key is exposed in your store files' },
        detail: {
          ar: 'هذا الملف يُحمَّل لدى كل زائر — أي شخص يستطيع نسخ المفتاح الآن. أبطِله فوراً.',
          en: 'This file is served to every visitor. Revoke the key now.',
        },
        // hit.masked مطموس عند المصدر — القيمة الكاملة لا تغادر findSecrets.
        evidence: `${hit.kind} at ${asset.url}:${line} → ${hit.masked}`,
      });
    }
  }

  return out;
}

// ── استيلاء على نطاق فرعي ───────────────────────────────────

export function evaluateDangling(input: SecurityInput): SecurityFinding[] {
  if (input.danglingCnames.length === 0) return [];

  return input.danglingCnames.map((host) => ({
    kind: 'dangling_cname' as const,
    severity: 'high' as const,
    title: { ar: `نطاق فرعي مهجور: ${host}`, en: `Dangling subdomain: ${host}` },
    detail: {
      ar: 'يشير إلى خدمة لم تعد موجودة — يستطيع شخص آخر السيطرة عليه باسمك.',
      en: 'It points at a service that no longer exists, so someone else can claim it.',
    },
    evidence: `CNAME for ${host} does not resolve`,
  }));
}

// ── التجميع ──────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** يشغّل كل التقييمات ويرتّب النتائج بالأخطر أولاً. */
export function evaluateSecurity(input: SecurityInput): SecurityFinding[] {
  return [
    ...evaluateSecrets(input),
    ...evaluateDomain(input),
    ...evaluateCert(input),
    ...evaluateDangling(input),
    ...evaluateMail(input),
    ...evaluateCookies(input),
    ...evaluateMixedContent(input),
    ...evaluateHeaders(input),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * الإنذار الواحد المعروض في الفحص المجاني.
 *
 * الأصدم يفوز: مفتاح مكشوف، ثم نطاق ينتهي، ثم شهادة، ثم الباقي.
 * واحد فقط — لأن وظيفة الفحص المجاني خلق الألم لا حلّه.
 */
export function headlineFinding(findings: SecurityFinding[]): SecurityFinding | null {
  return findings[0] ?? null;
}
