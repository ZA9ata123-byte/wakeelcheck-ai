/**
 * العقود المشتركة لكل حزم وكيل تشيك.
 *
 * هذا الملف هو المرجع الوحيد لأشكال البيانات. لا يستورد شيئاً، ولا يحتوي منطقاً —
 * تغييره يعني تغيير عقد بين حزمتين، فتعامل معه كواجهة عامة.
 */

export type Platform = 'salla' | 'zid' | 'shopify' | 'woocommerce' | 'magento' | 'custom';

export type Engine = 'chatgpt' | 'ai_overviews' | 'ai_mode' | 'perplexity';

export type ScanKind = 'quick' | 'full' | 'monitor';

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type QuestionIntent = 'discovery' | 'price' | 'shipping' | 'comparison';

/** كل نص يظهر للمستخدم يأتي بلغتين — الواجهة تختار حسب locale. */
export interface Bilingual {
  ar: string;
  en: string;
}

// ─────────────────────────────────────────────────────────────
// ملف المتجر — ما نعرفه قبل طرح أي سؤال
// ─────────────────────────────────────────────────────────────

export interface StoreProfile {
  domain: string;
  platform: Platform;
  /** تخصص المتجر بكلمات زبونه، مثل "عبايات نسائية". */
  category: string;
  /** المدينة إن أمكن استنتاجها، وإلا null. */
  city: string | null;
  /** BCP-47، مثل "ar-SA". */
  locale: string;
  currency: string | null;
  /** حتى 10 روابط منتجات — القواعد تُقيَّم عليها لا على الصفحة الرئيسية. */
  productUrls: string[];
}

// ─────────────────────────────────────────────────────────────
// المرآة
// ─────────────────────────────────────────────────────────────

export interface BuyingQuestion {
  id: string;
  text: string;
  intent: QuestionIntent;
}

export interface CompetitorMention {
  name: string;
  domain: string | null;
  /** ترتيب أول ظهور في نص الإجابة. 1 = الأول. */
  position: number;
}

/**
 * العقد المركزي: هذا ما يبيعه المنتج.
 *
 * `answerText` يُخزَّن حرفياً كما خرج من المحرك. لا تنظيف، لا اقتصاص،
 * لا إعادة صياغة — تعديله يُبطل قيمته كدليل.
 */
export interface EngineAnswer {
  questionId: string;
  engine: Engine;
  answerText: string;
  citedUrls: string[];
  storeMentioned: boolean;
  competitors: CompetitorMention[];
  /** ISO 8601. */
  capturedAt: string;
  /** التكلفة بالدولار × 1e6، للمحاسبة الدقيقة بلا كسور عشرية. */
  costMicros: number;
}

export interface ShareOfVoice {
  /** كم مرة ذُكر المتجر من إجمالي الإجابات. */
  store: number;
  /** أكثر منافس ذُكر، أو null إن لم يُذكر أحد. */
  top: CompetitorMention | null;
  /** إجمالي الإجابات المفحوصة. */
  total: number;
}

// ─────────────────────────────────────────────────────────────
// الأمان
// ─────────────────────────────────────────────────────────────

export type SecurityKind =
  | 'domain_expiry'
  | 'tls_expiry'
  | 'no_dmarc'
  | 'no_spf'
  | 'exposed_secret'
  | 'dangling_cname'
  | 'missing_headers'
  | 'cookie_flags'
  | 'mixed_content'
  | 'directory_listing';

export interface SecurityFinding {
  kind: SecurityKind;
  severity: Severity;
  title: Bilingual;
  detail: Bilingual;
  /**
   * دليل مطموس دائماً. لا يحتوي قيمة سرّ كاملة في أي حال —
   * مرّر كل قيمة على `maskSecret` قبل وضعها هنا.
   */
  evidence: string;
  /** ISO 8601 لما ينتهي (نطاق أو شهادة). */
  expiresAt?: string;
}

// ─────────────────────────────────────────────────────────────
// الجاهزية
// ─────────────────────────────────────────────────────────────

export interface RuleResult {
  /** مفتاح دلالي مثل "schema.product" — لا أرقام. */
  key: string;
  passed: boolean;
  weight: number;
  detail: Bilingual;
  evidence: string;
  /** كود جاهز للصق يُصلح الإخفاق، إن وُجد. */
  fixSnippet?: string;
}

// ─────────────────────────────────────────────────────────────
// نتيجة الفحص — ما ترجعه GET /api/scan/:id
// ─────────────────────────────────────────────────────────────

export interface ScanResult {
  id: string;
  kind: ScanKind;
  status: ScanStatus;
  profile: StoreProfile | null;
  questions: BuyingQuestion[];
  answers: EngineAnswer[];
  security: SecurityFinding[];
  rules: RuleResult[];
  shareOfVoice: ShareOfVoice;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// الجلب
// ─────────────────────────────────────────────────────────────

export interface FetchResult {
  status: number;
  /** أسماء الترويسات بحروف صغيرة. */
  headers: Record<string, string>;
  body: string;
  /** زمن وصول الترويسات بالمللي ثانية، مقيساً من الخادم لا من المتصفح. */
  ttfbMs: number;
  /** الرابط النهائي بعد إعادات التوجيه. */
  finalUrl: string;
  /** عدد إعادات التوجيه المتبعة. */
  redirects: number;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  maxRedirects?: number;
}
