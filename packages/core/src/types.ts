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

/**
 * حالة المتجر عند محرّك واحد.
 *
 * ثلاث حالات لا اثنتان. `not_measured` ليست `absent`: محرّك سقط اليوم
 * يترك ثقباً، وعرضه كغياب يجعل التاجر يقرأ عطلاً عندنا غياباً عنده —
 * خرق صامت للقاعدة 06.
 */
export type EngineCoverage = 'mentioned' | 'absent' | 'not_measured';

/** صفٌّ واحد في المصفوفة — محرّك واحد وما ظهر فيه. */
export interface EngineRow {
  engine: Engine;
  coverage: EngineCoverage;
  /** كم إجابة من هذا المحرّك ذُكر فيها المتجر. */
  storeMentions: number;
  /** كم إجابة عادت من هذا المحرّك. صفر ⇒ `not_measured`. */
  answers: number;
  /** المنافسون في إجابات هذا المحرّك وحده، مرتّبون تنازلياً. */
  ranked: readonly CompetitorMention[];
}

/** حالة خانة واحدة في المصفوفة. */
export interface MatrixCell {
  engine: Engine;
  state: EngineCoverage;
}

/**
 * صفٌّ في المصفوفة — المتجر أو منافس، وحضورُه عبر الأسطح.
 *
 * الهوية موحَّدة عبر المحرّكات: «بيت الأناقة» و«بيت الاناقه» صفٌّ واحد،
 * وإلّا ظهر الاسم مرّتين وبدا منافسَين اثنين.
 */
export interface MatrixRow {
  name: string;
  domain: string | null;
  /** صفُّ المتجر يُميَّز بصرياً — هو ما جاء التاجر ليراه. */
  isStore: boolean;
  cells: readonly MatrixCell[];
  /** كم عموداً ظهر فيه. */
  present: number;
  /** كم عموداً قِيس فعلاً — مقام النسبة، فلا يُحسب ما لم يُقَس. */
  measured: number;
}

export interface ShareOfVoice {
  /** كم مرة ذُكر المتجر من إجمالي الإجابات. */
  store: number;
  /** أكثر منافس ذُكر، أو null إن لم يُذكر أحد. */
  top: CompetitorMention | null;
  /** إجمالي الإجابات المفحوصة. */
  total: number;
  /**
   * تفصيل لكل محرّك — إضافةً إلى الإجمالي أعلاه لا بدلاً منه.
   *
   * الترتيب هو ترتيب المحرّكات المطلوبة في الخطة، فيبقى العمود في مكانه
   * حتى حين لا يعود منه شيء.
   */
  byEngine: readonly EngineRow[];
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
