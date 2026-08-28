/**
 * تجريد مزوّد النموذج.
 *
 * القاعدة الملزمة رقم 03: لا ملف يستدعي ox-alpha أو DeepSeek مباشرةً.
 * كل نداء يمرّ من `llm.complete()`.
 *
 * السبب: ox-alpha معاينة مجانية لفترة محدودة من مطوّر لا يُعرّف عن نفسه.
 * البناء عليه مباشرةً يعني أن اختفاءه يوقف المنتج. مع هذه الطبقة، اختفاؤه
 * يعني تغيير قيمة واحدة في البيئة.
 */

export interface LlmRequest {
  system: string;
  user: string;
  /** يطلب من المزوّد إرجاع JSON صالحاً. */
  json?: boolean;
  maxTokens?: number;
  /** 0 للمهام الاستخراجية، أعلى للتوليد. */
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  /** التكلفة بالدولار × 1e6. */
  costMicros: number;
  /** اسم المزوّد الذي ردّ فعلاً — قد لا يكون الأول في الترتيب. */
  provider: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly name: string;
  /** false إن نقص المفتاح — يُتخطّى بلا محاولة اتصال. */
  readonly available: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** أسعار الدولار لكل مليون توكن. */
export interface Pricing {
  input: number;
  output: number;
}

export function costMicros(
  pricing: Pricing,
  inputTokens: number,
  outputTokens: number
): number {
  const dollars =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return Math.round(dollars * 1_000_000);
}

/**
 * تقدير عدد التوكنات حين لا يُرجعها المزوّد.
 *
 * العربية أكثف توكنياً من الإنجليزية في أغلب المُرمِّزات، لذا النسبة هنا
 * أقل من قاعدة «4 محارف لكل توكن» الشائعة.
 */
export function estimateTokens(text: string): number {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const rest = text.length - arabic;
  return Math.ceil(arabic / 2 + rest / 4);
}
