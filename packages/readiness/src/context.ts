/**
 * ما تستقبله كل قاعدة.
 *
 * السياق يُبنى مرة واحدة في العامل ثم يُمرَّر لكل القواعد. القواعد نفسها
 * دوال خالصة: لا شبكة، لا قاعدة بيانات، لا وقت — وهذا ما يجعل اختبارها
 * على HTML ثابت ممكناً بلا أي بنية تحتية.
 */

import type { Bilingual, RuleResult } from '@wakeelcheck/core';
import type { Robots } from './robots.ts';

export interface PageSnapshot {
  url: string;
  status: number;
  headers: Record<string, string>;
  html: string;
}

export interface ScanContext {
  domain: string;
  /** الصفحة الرئيسية. */
  home: PageSnapshot;
  /**
   * صفحات المنتجات — حتى 10.
   *
   * الإصلاح الثاني: قواعد Product و Offer و AggregateRating تُقيَّم هنا،
   * لا على الرئيسية. الصفحات الرئيسية للمتاجر لا تحمل Product Schema عادةً،
   * فتقييمها عليها كان يُرسِب كل متجر مهما كان مضبوطاً.
   */
  products: PageSnapshot[];
  robots: Robots;
  llmsTxt: string | null;
  sitemapFound: boolean;
}

/** قاعدة واحدة: مفتاح دلالي، وزن، ودالة تقييم خالصة. */
export interface Rule {
  key: string;
  weight: number;
  /** false يعني أن القاعدة لا تدخل النتيجة بعد — انظر registry.ts. */
  active: boolean;
  /**
   * `products` يعني: هذه القاعدة **لا يمكن أن تنجح** بلا صفحات منتجات،
   * مهما كانت الرئيسية مضبوطة. إخفاقها بلا صفحات ليس حكماً على المتجر بل
   * غيابُ ما يُقاس.
   *
   * على متجرنا نُبقيه إخفاقاً: نحن نزحف موقعه كاملاً، وعجزُنا عن إيجاد
   * صفحة منتج نتيجةٌ في ذاتها. أمّا على منافسٍ نزوره زيارةً واحدة فقد
   * يكون مخطّط روابطه مختلفاً لا موقعه ناقصاً — فتُستبعد من المقارنة بدل
   * أن تُقرأ تفوّقاً لم يحدث.
   *
   * يحرسه اختبار: كل قاعدة موسومة يجب أن تُخفق على رئيسيةٍ مثاليةٍ بلا
   * منتجات، وكل قاعدة غير موسومة يجب أن تنجح عليها.
   */
  needs?: 'products';
  evaluate(ctx: ScanContext): Omit<RuleResult, 'key' | 'weight'>;
}

/** مختصر لبناء نتيجة قاعدة بلغتين. */
export function result(
  passed: boolean,
  detail: Bilingual,
  evidence: string,
  fixSnippet?: string
): Omit<RuleResult, 'key' | 'weight'> {
  return fixSnippet === undefined
    ? { passed, detail, evidence }
    : { passed, detail, evidence, fixSnippet };
}
