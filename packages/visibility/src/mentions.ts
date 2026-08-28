/**
 * استخراج الذكر — قلب المنتج.
 *
 * سؤالان يُجابان هنا: هل ذُكر متجرك في إجابة المحرك؟ ومن ذُكر بدلاً منك؟
 * الجواب الأول مطابقة نصية خالصة — حتمية ومجانية وقابلة للاختبار. الثاني
 * يحتاج نموذجاً لقراءة النثر العربي، لكن كل اسم يعود منه يُتحقّق من وجوده
 * الفعلي في النص قبل قبوله.
 */

import type { CompetitorMention, StoreProfile } from '@wakeelcheck/core';
import { parseJson, type LlmProvider } from '@wakeelcheck/llm';

// ── تطبيع عربي ───────────────────────────────────────────────

const DIACRITICS = /[ً-ْٰـ]/g;

/**
 * يوحّد صور الحرف العربي حتى تتطابق «دار الأناقة» مع «دار الاناقه».
 * التجار يكتبون أسماءهم بصور مختلفة، والنماذج تعيد كتابتها بصور أخرى.
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** كلمات عامة تسبق اسم المتجر ولا تميّزه. */
const GENERIC_PREFIXES = [
  'متجر',
  'محل',
  'موقع',
  'شركه',
  'مؤسسه',
  'موسسه',
  'سوق',
  'ستور',
  'store',
  'shop',
  'the',
];

function stripGeneric(name: string): string {
  const words = name.split(' ');
  const first = words[0];
  return words.length > 1 && first !== undefined && GENERIC_PREFIXES.includes(first)
    ? words.slice(1).join(' ')
    : name;
}

const LETTER = /[\p{L}\p{N}]/u;

/**
 * هل يظهر المصطلح في النص ككلمة قائمة بذاتها؟
 *
 * `\b` في JS لا يتعامل مع العربية، فنفحص المحرف المجاور يدوياً. بلا هذا
 * يطابق «دار» داخل «مدارس» ويُنتج ذكراً وهمياً.
 */
export function containsTerm(haystack: string, needle: string): boolean {
  if (needle.length < 3) return false;

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;

    const before = at === 0 ? '' : (haystack[at - 1] ?? '');
    const afterIndex = at + needle.length;
    const after = afterIndex >= haystack.length ? '' : (haystack[afterIndex] ?? '');

    if (!LETTER.test(before) && !LETTER.test(after)) return true;
    from = at + 1;
  }
}

/** كل الصور التي قد يُكتب بها اسم المتجر في إجابة نموذج. */
export function storeAliases(profile: StoreProfile, brandName?: string): string[] {
  const aliases = new Set<string>();

  const bare = profile.domain.replace(/^www\./, '');
  aliases.add(normalizeArabic(bare));

  const label = bare.split('.')[0];
  if (label !== undefined && label.length >= 3) aliases.add(normalizeArabic(label));

  if (brandName !== undefined && brandName.trim().length > 0) {
    const normalized = normalizeArabic(brandName);
    aliases.add(normalized);
    aliases.add(stripGeneric(normalized));
  }

  return [...aliases].filter((a) => a.length >= 3);
}

/** هل ذُكر المتجر في هذه الإجابة؟ */
export function detectStoreMention(
  answerText: string,
  profile: StoreProfile,
  brandName?: string
): boolean {
  const haystack = normalizeArabic(answerText);
  return storeAliases(profile, brandName).some((alias) => containsTerm(haystack, alias));
}

// ── المنافسون ────────────────────────────────────────────────

const EXTRACT_SYSTEM = `أنت تستخرج أسماء المتاجر من إجابة محرك بحث.

أعِد JSON فقط بالشكل: {"competitors":[{"name":"...","domain":"..."|null}]}

القواعد:
- انسخ اسم كل متجر تجاري كما ورد حرفياً في النص، بلا تصحيح أو ترجمة.
- لا تُدرج أسماء منصات (سلة، زد، شوبيفاي، أمازون) ولا مدناً ولا فئات منتجات.
- إن لم يُذكر أي متجر، أعِد {"competitors":[]}.
- لا تخترع اسماً غير موجود في النص.`;

interface ExtractedShape {
  competitors?: { name?: unknown; domain?: unknown }[];
}

/**
 * يستخرج المتاجر المذكورة في الإجابة، ويستبعد متجر العميل نفسه.
 *
 * الصمام: كل اسم يعود من النموذج يُتحقّق من وجوده حرفياً في النص. النماذج
 * تخترع أسماء تبدو معقولة، ومنافس مخترع في تقرير يُقدَّم كدليل يُدمّر
 * مصداقية المنتج كله.
 */
export async function extractCompetitors(
  answerText: string,
  profile: StoreProfile,
  llm: LlmProvider,
  brandName?: string
): Promise<CompetitorMention[]> {
  if (answerText.trim().length === 0) return [];

  const response = await llm.complete({
    system: EXTRACT_SYSTEM,
    user: answerText,
    json: true,
    temperature: 0,
    maxTokens: 600,
  });

  let parsed: ExtractedShape;
  try {
    parsed = parseJson<ExtractedShape>(response.text);
  } catch {
    return []; // ردّ معطوب: لا منافسين خير من منافسين مخترعين
  }

  const haystack = normalizeArabic(answerText);
  const own = storeAliases(profile, brandName);
  const seen = new Set<string>();
  const out: CompetitorMention[] = [];

  for (const entry of parsed.competitors ?? []) {
    if (typeof entry?.name !== 'string') continue;

    const name = entry.name.trim();
    if (name.length < 3) continue;

    const normalized = normalizeArabic(name);

    // الصمام: لا يُقبل اسم لا يظهر في النص فعلاً.
    if (!containsTerm(haystack, normalized)) continue;

    // متجر العميل ليس منافساً لنفسه.
    if (own.some((alias) => alias === normalized || containsTerm(normalized, alias))) continue;

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    out.push({
      name,
      domain: typeof entry.domain === 'string' && entry.domain.length > 0 ? entry.domain : null,
      position: haystack.indexOf(normalized),
    });
  }

  // الترتيب بموضع الظهور، ثم إعادة الترقيم من 1.
  return out
    .sort((a, b) => a.position - b.position)
    .map((mention, index) => ({ ...mention, position: index + 1 }));
}

// ── حصة الصوت ────────────────────────────────────────────────

export interface MentionSummary {
  storeMentions: number;
  total: number;
  /** المنافسون مرتّبون بعدد مرات الذكر تنازلياً. */
  ranked: { name: string; domain: string | null; mentions: number }[];
}

/** يجمّع نتائج كل الإجابات في صورة واحدة — هذه لوحة «حصة الصوت». */
export function summarize(
  answers: readonly { storeMentioned: boolean; competitors: readonly CompetitorMention[] }[]
): MentionSummary {
  const counts = new Map<string, { name: string; domain: string | null; mentions: number }>();

  for (const answer of answers) {
    // متجر واحد يُحسب مرة واحدة لكل إجابة مهما تكرّر داخلها.
    const withinAnswer = new Set<string>();

    for (const competitor of answer.competitors) {
      const key = normalizeArabic(competitor.name);
      if (withinAnswer.has(key)) continue;
      withinAnswer.add(key);

      const existing = counts.get(key);
      if (existing === undefined) {
        counts.set(key, { name: competitor.name, domain: competitor.domain, mentions: 1 });
      } else {
        existing.mentions++;
        existing.domain ??= competitor.domain;
      }
    }
  }

  return {
    storeMentions: answers.filter((a) => a.storeMentioned).length,
    total: answers.length,
    ranked: [...counts.values()].sort((a, b) => b.mentions - a.mentions),
  };
}
