/**
 * استخراج الذكر — قلب المنتج.
 *
 * سؤالان يُجابان هنا: هل ذُكر متجرك في إجابة المحرك؟ ومن ذُكر بدلاً منك؟
 * الجواب الأول مطابقة نصية خالصة — حتمية ومجانية وقابلة للاختبار. الثاني
 * يحتاج نموذجاً لقراءة النثر العربي، لكن كل اسم يعود منه يُتحقّق من وجوده
 * الفعلي في النص قبل قبوله.
 */

import type {
  CompetitorMention,
  Engine,
  EngineCoverage,
  EngineRow,
  MatrixRow,
  StoreProfile,
} from '@wakeelcheck/core';
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

/**
 * الحضور لكل محرّك على حدة — أساس المصفوفة.
 *
 * البيانات كلّها موجودة أصلاً: كلّ `EngineAnswer` تحمل `engine`
 * و`storeMentioned` و`competitors`. هذا تجميعٌ لا جمعُ بياناتٍ جديد.
 *
 * **مصدر «لم يُقَس».** الإصدار اقترح ربطها بـ`warnings`، وفضّلتُ الفرق بين
 * `planned` و`answers`: المحرّك المطلوب الذي لم تعد منه إجابة واحدة لم
 * يُقَس، سواءٌ سقط أو لم يُعَدّ أصلاً. هذا فرقٌ بنيوي، بينما `warnings`
 * نصٌّ حرّ تحليلُه هشّ وينكسر بتغيير صياغة رسالة.
 *
 * والترتيب هو ترتيب `planned` لا ترتيب وصول الإجابات، فيبقى كلّ عمود في
 * مكانه بين فحص وآخر.
 */
export function summarizeByEngine(
  answers: readonly {
    engine: Engine;
    storeMentioned: boolean;
    competitors: readonly CompetitorMention[];
  }[],
  planned: readonly Engine[]
): EngineRow[] {
  return planned.map((engine) => {
    const mine = answers.filter((a) => a.engine === engine);

    // لا إجابة ⇒ ثقب. عرضه غياباً يجعل التاجر يقرأ عطلاً عندنا
    // غياباً عنده — القاعدة 06.
    if (mine.length === 0) {
      return { engine, coverage: 'not_measured', storeMentions: 0, answers: 0, ranked: [] };
    }

    // نفس مفتاح الهوية المستعمل في summarize: اختلاف التهجئة ليس منافساً
    // جديداً، وإلّا حُسب في المرحلة 4 تغيُّراً أسبوعياً وهو الاسم نفسه.
    const counts = new Map<string, { name: string; domain: string | null; mentions: number }>();

    for (const a of mine) {
      const withinAnswer = new Set<string>();

      for (const competitor of a.competitors) {
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

    const storeMentions = mine.filter((a) => a.storeMentioned).length;

    return {
      engine,
      coverage: storeMentions > 0 ? 'mentioned' : 'absent',
      storeMentions,
      answers: mine.length,
      ranked: [...counts.values()]
        .sort((a, b) => b.mentions - a.mentions)
        .map((c) => ({ name: c.name, domain: c.domain, position: 1 })),
    };
  });
}


/**
 * يبني شبكة المصفوفة من مخرَج `summarizeByEngine`.
 *
 * صفٌّ للمتجر ثمّ صفٌّ لكل منافس، وعمودٌ لكل محرّك. البنية هنا لا في
 * المكوّن، لأنّ توحيد الهوية عبر المحرّكات منطقٌ يستحقّ اختباراً:
 * «بيت الأناقة» من محرّك و«بيت الاناقه» من آخر صفٌّ واحد لا صفّان.
 *
 * وحالة الخانة تأتي من حالة العمود أولاً: عمودٌ لم يُقَس تكون كلّ خاناته
 * `not_measured` — لا نقول عن منافسٍ إنّه غائبٌ من سطحٍ لم نسأله أصلاً.
 */
export function buildMatrix(
  byEngine: readonly EngineRow[],
  storeLabel: string
): MatrixRow[] {
  const engines = byEngine.map((r) => r.engine);

  const storeRow: MatrixRow = {
    name: storeLabel,
    domain: null,
    isStore: true,
    cells: byEngine.map((r) => ({ engine: r.engine, state: r.coverage })),
    present: byEngine.filter((r) => r.coverage === 'mentioned').length,
    measured: byEngine.filter((r) => r.coverage !== 'not_measured').length,
  };

  // اتحاد المنافسين بمفتاح موحَّد، مع الاحتفاظ بأول تهجئة ظهرت.
  const identity = new Map<string, { name: string; domain: string | null; at: Set<string> }>();

  for (const row of byEngine) {
    for (const competitor of row.ranked) {
      const key = normalizeArabic(competitor.name);
      const existing = identity.get(key);
      if (existing === undefined) {
        identity.set(key, {
          name: competitor.name,
          domain: competitor.domain,
          at: new Set([row.engine]),
        });
      } else {
        existing.at.add(row.engine);
        existing.domain ??= competitor.domain;
      }
    }
  }

  const rivalRows: MatrixRow[] = [...identity.values()].map((c) => {
    const cells = engines.map((engine) => {
      const column = byEngine.find((r) => r.engine === engine);
      // حالة العمود تسبق حضور الاسم: لا غيابَ من سطحٍ لم يُسأل.
      const state: EngineCoverage =
        column === undefined || column.coverage === 'not_measured'
          ? 'not_measured'
          : c.at.has(engine)
            ? 'mentioned'
            : 'absent';
      return { engine, state };
    });

    return {
      name: c.name,
      domain: c.domain,
      isStore: false,
      cells,
      present: cells.filter((x) => x.state === 'mentioned').length,
      measured: cells.filter((x) => x.state !== 'not_measured').length,
    };
  });

  // الأكثر حضوراً أولاً — التاجر يريد أن يعرف من يتصدّر عليه.
  rivalRows.sort((a, b) => b.present - a.present);

  return [storeRow, ...rivalRows];
}
