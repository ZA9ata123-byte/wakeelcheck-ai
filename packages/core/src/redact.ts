/**
 * طمس الأسرار.
 *
 * القاعدة الملزمة رقم 01: قيمة سرّ كاملة لا تدخل قاعدة البيانات ولا السجلّات
 * ولا استجابة API — أبداً. كل ما يخرج من فحص الأسرار يمرّ من هنا أولاً.
 *
 * السبب عملي لا شكلي: لحظة نخزّن مفاتيح دفع حقيقية لمئات المتاجر نتحوّل
 * من أداة فحص إلى أثمن هدف اختراق في السوق.
 */

export interface SecretHit {
  /** نوع السرّ المكتشف. */
  kind: SecretKind;
  /** القيمة بعد الطمس — آمنة للتخزين والعرض. */
  masked: string;
  /** موضع البداية في النص المفحوص، للإشارة إلى السطر. */
  index: number;
}

export type SecretKind =
  | 'stripe_secret'
  | 'stripe_restricted'
  | 'aws_access_key'
  | 'google_api_key'
  | 'openai_key'
  | 'slack_token'
  | 'github_token'
  | 'jwt'
  | 'private_key_block'
  | 'generic_bearer';

interface Pattern {
  kind: SecretKind;
  re: RegExp;
}

/**
 * أنماط الأسرار التي تظهر فعلاً في حزم JS العامة للمتاجر.
 * ملاحظة: `pk_live_` (المفتاح المنشور) ليس سرّاً ولا يُبلَّغ عنه.
 */
const PATTERNS: readonly Pattern[] = [
  { kind: 'stripe_secret', re: /\bsk_live_[0-9a-zA-Z]{16,}/g },
  { kind: 'stripe_restricted', re: /\brk_live_[0-9a-zA-Z]{16,}/g },
  { kind: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'openai_key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack_token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { kind: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    kind: 'private_key_block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  { kind: 'generic_bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/gi },
];

const DOT = '•'; // •

/**
 * يطمس قيمة واحدة مع إبقاء ما يكفي للتعرّف عليها.
 *
 *   <بادئة Stripe> + 24 محرفاً  →  sk_live•••••••••••4f2a
 *   short                       →  ••••••••
 *
 * القيم القصيرة تُطمس بالكامل: إبقاء أطرافها قد يكفي لتخمينها.
 */
export function maskSecret(value: string): string {
  if (value.length < 12) return DOT.repeat(8);

  // نُبقي بادئة قصيرة تكفي للتعرّف على النوع، بحد أقصى 7 محارف،
  // وبما لا يتجاوز ثلث الطول حتى لا نكشف الكثير من القيم القصيرة.
  const head = Math.min(7, Math.floor(value.length / 3));
  const tail = 4;
  const hidden = Math.max(4, value.length - head - tail);

  return value.slice(0, head) + DOT.repeat(Math.min(hidden, 12)) + value.slice(-tail);
}

/**
 * يبحث عن كل الأسرار في نص (عادةً حزمة JS مُقدَّمة علناً).
 * القيم المُرجَعة مطموسة — الأصل لا يغادر هذه الدالة.
 */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();

  for (const { kind, re } of PATTERNS) {
    // نسخة جديدة في كل استدعاء: RegExp عام يحمل lastIndex بين النداءات.
    const scanner = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;

    while ((match = scanner.exec(text)) !== null) {
      const raw = match[0];
      const masked = maskSecret(raw);
      const dedupeKey = `${kind}:${masked}`;

      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        hits.push({ kind, masked, index: match.index });
      }

      // حماية من الحلقة اللانهائية عند مطابقة بطول صفر.
      if (match.index === scanner.lastIndex) scanner.lastIndex++;
    }
  }

  return hits.sort((a, b) => a.index - b.index);
}

/**
 * يستبدل كل سرّ داخل نص بنسخته المطموسة.
 * استعمله قبل كتابة أي محتوى خارجي في السجلّات أو رسائل الأخطاء.
 */
export function redactText(text: string): string {
  let out = text;

  for (const { re } of PATTERNS) {
    const scanner = new RegExp(re.source, re.flags);
    out = out.replace(scanner, (raw) => maskSecret(raw));
  }

  return out;
}

/** يُرجع true إن كان النص يحتوي أي سرّ. للتأكيد في الاختبارات. */
export function containsSecret(text: string): boolean {
  return PATTERNS.some(({ re }) => new RegExp(re.source, re.flags).test(text));
}
