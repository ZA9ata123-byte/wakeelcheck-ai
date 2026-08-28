/**
 * محلّل robots.txt وفق RFC 9309.
 *
 * هذا الملف هو الإصلاح الأهم في الحزمة. المحرّك القديم كان يفحص بـ
 * `robotsTxt.includes('gptbot')` و `includes('disallow: /')` على الملف كله،
 * فكانت النتيجة مقلوبة تماماً:
 *
 *   متجر يسمح لـ GPTBot صراحةً   →  «راسب»
 *   متجر يحظر كل البوتات          →  «ناجح»
 *
 * الصواب يتطلب تحليل المجموعات: كل مجموعة تبدأ بسطر أو أكثر من
 * `User-agent`، وتليها قواعد `Allow` و `Disallow` تخصّ تلك المجموعة وحدها.
 */

export interface RobotsRule {
  /** true لـ Allow، false لـ Disallow. */
  allow: boolean;
  /** المسار كما ورد، قد يحتوي `*` و `$`. */
  path: string;
}

export interface RobotsGroup {
  /** أسماء الوكلاء بحروف صغيرة. */
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export interface Robots {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** true إن كان الملف موجوداً وفيه توجيه واحد على الأقل. */
  hasDirectives: boolean;
}

const EMPTY: Robots = { groups: [], sitemaps: [], hasDirectives: false };

export function parseRobots(text: string | null): Robots {
  if (text === null || text.trim().length === 0) return EMPTY;

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let current: RobotsGroup | null = null;
  // بعد أول قاعدة، سطر User-agent جديد يبدأ مجموعة جديدة بدل أن يضاف للحالية.
  let sawRuleInCurrent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line.length === 0) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (current === null || sawRuleInCurrent) {
          current = { agents: [], rules: [], crawlDelay: null };
          groups.push(current);
          sawRuleInCurrent = false;
        }
        current.agents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (current === null) break; // قاعدة بلا مجموعة — تُهمل
        // `Disallow:` فارغة تعني «اسمح بكل شيء»، ولا تُضاف كقاعدة.
        if (field === 'disallow' && value.length === 0) {
          sawRuleInCurrent = true;
          break;
        }
        if (value.length === 0) break;
        current.rules.push({ allow: field === 'allow', path: value });
        sawRuleInCurrent = true;
        break;
      }
      case 'crawl-delay': {
        if (current === null) break;
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) current.crawlDelay = parsed;
        sawRuleInCurrent = true;
        break;
      }
      case 'sitemap': {
        if (value.length > 0) sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return {
    groups,
    sitemaps,
    hasDirectives: groups.length > 0 || sitemaps.length > 0,
  };
}

/**
 * يختار المجموعة التي تنطبق على وكيل بعينه.
 *
 * القاعدة: أطول اسم وكيل مطابق يفوز. `*` احتياطي لا يُستعمل إلا
 * إن لم توجد مجموعة تسمّي الوكيل صراحةً.
 */
export function groupFor(robots: Robots, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();

  let best: RobotsGroup | null = null;
  let bestLength = -1;
  let fallback: RobotsGroup | null = null;

  for (const group of robots.groups) {
    for (const name of group.agents) {
      if (name === '*') {
        fallback ??= group;
        continue;
      }
      // المطابقة ببادئة: "googlebot" في الملف تنطبق على "googlebot-news".
      if (agent.startsWith(name) && name.length > bestLength) {
        best = group;
        bestLength = name.length;
      }
    }
  }

  return best ?? fallback;
}

/** يحوّل مسار robots إلى تعبير نمطي، مع دعم `*` و `$`. */
function pathToRegExp(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = anchored ? path.slice(0, -1) : path;

  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * هل يُسمح لهذا الوكيل بجلب هذا المسار؟
 *
 * داخل المجموعة تفوز أطول قاعدة مطابقة. عند التساوي في الطول تفوز `Allow` —
 * وهذا نصّ المعيار، وهو ما يجعل متجراً يكتب `Allow: /` مع `Disallow: /cart`
 * مسموحاً على الجذر بدل أن يُحسب محظوراً.
 */
export function isAllowed(robots: Robots, userAgent: string, path = '/'): boolean {
  if (!robots.hasDirectives) return true; // لا ملف أو لا توجيهات = لا قيود

  const group = groupFor(robots, userAgent);
  if (group === null || group.rules.length === 0) return true;

  let winner: RobotsRule | null = null;
  let winnerLength = -1;

  for (const rule of group.rules) {
    if (!pathToRegExp(rule.path).test(path)) continue;

    const length = rule.path.length;
    if (length > winnerLength || (length === winnerLength && rule.allow)) {
      winner = rule;
      winnerLength = length;
    }
  }

  return winner === null ? true : winner.allow;
}

/**
 * هل ذُكر هذا الوكيل صراحةً في الملف؟
 *
 * مفيد للتمييز في التقرير بين «مسموح لأن المتجر رحّب به» و«مسموح لأن
 * أحداً لم يذكره» — الحالتان تمرّان، لكن الأولى إشارة نضج.
 */
export function isNamed(robots: Robots, userAgent: string): boolean {
  const agent = userAgent.toLowerCase();
  return robots.groups.some((group) =>
    group.agents.some((name) => name !== '*' && agent.startsWith(name))
  );
}
