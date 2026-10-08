/**
 * تشغيل الفحص وتسويته — من لحظة القبول إلى لحظة التخزين.
 *
 * فُصل عن `scans.ts` ليُختبر بلا شبكة ولا مفتاح: كل ما يلامس العالم
 * الخارجي يُحقن هنا كما يُحقن في الحزم.
 *
 * ## لماذا وُجد
 *
 * كان الفحص يُطلق بـ`void` ويُترك. ثلاثة أشياء ضاعت معه:
 *
 * 1. **الإنفاق لم يُسجَّل قطّ.** `checkBudget` يقرأ ما صُرف، ولا شيء كان
 *    يكتبه — فالسقف الشهريّ كان يقرأ صفراً دائماً.
 * 2. **الكاش لم يُكتب قطّ.** `getCachedScan` يسأل، ولا شيء كان يجيب — فمتجرٌ
 *    واحد يفحصه ألف زائر يكلّف ألف فحص.
 * 3. **لا شيء يُبقي الدالة حيّة.** المنصّة لا تضمن إكمال عملٍ لم يُنتظَر
 *    بعد إرسال الردّ.
 *
 * الثلاثة لم تظهر لأن الوضع التجريبي لا يُنفق درهماً. كانت ستظهر مع أول
 * مفتاح حقيقي.
 */

import type { ScanKind, ScanResult } from '@wakeelcheck/core';
import { recordSpend, setCachedScan, type KeyValueStore } from '@wakeelcheck/limits';
import {
  runScan,
  type PipelineDeps,
  type ScanOutcome,
  type ScanRequest,
} from '@wakeelcheck/pipeline';

// ── السقوف الزمنية ───────────────────────────────────────────
//
// ثلاثة أرقام مرتبطة، ويحرس ترتيبَها اختبار:
//
//   اللَّيِّن  <  الصُّلب  <  المنصّة
//
// اللَّيِّن يمنع بدء نداءٍ جديد. الصُّلب يقطع انتظار نداءٍ جارٍ. والفرق بين
// الصُّلب والمنصّة هامشٌ للأمان (حتى 8 ثوانٍ، بالتوازي) والتخزين.

/** سقف المنصّة — يطابق `maxDuration` في `app/api/scan/route.ts`. */
export const PLATFORM_LIMIT_MS = 60_000;

/** لا نداء محرّكٍ جديد بعده. يُمرَّر إلى `runScan` كـ`budgetMs`. */
export const SOFT_BUDGET_MS = 35_000;

/** لا انتظار لأيّ نداءٍ خارجيّ مدفوع بعده. */
export const HARD_DEADLINE_MS = 45_000;

// ── المهلة الصلبة ────────────────────────────────────────────

/**
 * يسابق نداءً بمهلة.
 *
 * النداء لا يُلغى — يُترك ليموت مع الدالة، وقد دُفع ثمنُه — لكنّ الفحص
 * يكمل بدونه ويُخزَّن قبل أن تقتله المنصّة. والمؤقّت يُنظَّف في الحالتين،
 * وإلّا أبقى عملية الاختبار حيّة بعد انتهائها.
 */
export function withDeadline<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error(`${label}: deadline passed`));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no reply within ${ms}ms`)), ms);
  });

  return Promise.race([task, expiry]).finally(() => clearTimeout(timer));
}

/**
 * يلفّ تبعيات الفحص بمهلةٍ صلبة على كلّ نداءٍ خارجيّ مدفوع.
 *
 * سقفُ `runScan` ليّن عمداً: يمنع **بدء** نداءٍ ولا يقطع جارياً، لأن الجاري
 * دُفع ثمنُه. لكنّ المنصّة لا تنتظر — عند `maxDuration` تُقتل الدالة، فلا
 * يُخزَّن الفحص ولا يُسجَّل إنفاقُه، ويبقى التاجر أمام «جارٍ» حتى ينفد صبر
 * الواجهة. فهنا، في الطبقة التي تعرف سقف المنصّة، نقطع انتظارَنا قبله.
 *
 * والساعة ساعةُ التبعيات نفسها — لا ساعة النظام — فتُختبر المهلة حتميّاً.
 */
export function withHardDeadline(deps: PipelineDeps, hardMs: number): PipelineDeps {
  const startedAt = deps.now().getTime();
  const left = (): number => hardMs - (deps.now().getTime() - startedAt);

  return {
    ...deps,
    askEngine: (engine, question, locale) =>
      withDeadline(deps.askEngine(engine, question, locale), left(), engine),
    llm: {
      name: deps.llm.name,
      available: deps.llm.available,
      complete: (req) => withDeadline(deps.llm.complete(req), left(), deps.llm.name),
    },
  };
}

// ── التخزين ──────────────────────────────────────────────────

/**
 * هل تُحفظ النتيجة لمن يسأل عن المتجر نفسه بعدها؟
 *
 * - **الوهميّ لا يُحفظ.** لو حُفظ ثم أُضيف المفتاح، خدم الكاشُ بياناتٍ
 *   نموذجية يوماً كاملاً على أنها حقيقية.
 * - **الفاشل لا يُحفظ.** التاجر يعيد المحاولة، ولا يُحبَس في خطأ.
 * - **فحصٌ بلا إجابةٍ واحدة لا يُحفظ.** هو غالباً عطلٌ عابر عند المحرّك،
 *   وحفظُه يحبس التاجر في «لم يُقَس» يوماً كاملاً بعد عودة المحرّك. وإعادتُه
 *   رخيصة: المحرّك الساقط لا يُكلّف.
 */
export function shouldCache(result: ScanResult, demo: boolean): boolean {
  if (demo) return false;
  if (result.status !== 'done') return false;
  return result.answers.length > 0;
}

export interface LaunchInput {
  url: string;
  /** النطاق مطبَّعاً — هو مفتاح الكاش نفسه الذي سأل عنه `admit`. */
  domain: string;
  kind: ScanKind;
  scanId: string;
  budgetMs: number;
  cacheTtlHours: number;
}

export interface LaunchContext {
  deps: PipelineDeps;
  demo: boolean;
  store: KeyValueStore;
  put(result: ScanResult): void;
  /** `runScan` في الإنتاج. يُستبدل في الاختبار حين يلزم فشلٌ لا ينتجه الخطّ. */
  run?: (req: ScanRequest, deps: PipelineDeps) => Promise<ScanOutcome>;
}

function shell(id: string, kind: ScanKind): ScanResult {
  return {
    id,
    kind,
    status: 'running',
    profile: null,
    questions: [],
    answers: [],
    security: [],
    rules: [],
    shareOfVoice: { store: 0, top: null, total: 0, byEngine: [] },
  };
}

/**
 * يُطلق الفحص ويُعيد وعداً يكتمل حين يُخزَّن ويُسجَّل إنفاقه.
 *
 * **الوعد لا يُرفض أبداً.** يُمرَّر إلى `after()`، ورفضٌ هناك لا يراه أحد.
 * كلُّ فشلٍ في الفحص يُخزَّن فحصاً فاشلاً يراه التاجر.
 *
 * والتخزين يسبق المحاسبة: التاجر ينتظر النتيجة، والدفتر لا يؤخّرها. فإن
 * سقط الدفتر بعدها بقيت النتيجة كما هي — لا يُفسَد ما رآه التاجر بخطأ
 * محاسبة.
 */
export async function launchScan(input: LaunchInput, ctx: LaunchContext): Promise<void> {
  const run = ctx.run ?? runScan;
  ctx.put(shell(input.scanId, input.kind));

  let outcome: ScanOutcome;
  try {
    outcome = await run(
      { url: input.url, kind: input.kind, budgetMs: input.budgetMs },
      { ...ctx.deps, newId: () => input.scanId }
    );
  } catch (err) {
    ctx.put({
      ...shell(input.scanId, input.kind),
      status: 'failed',
      error: err instanceof Error ? err.message : 'scan failed',
    });
    return;
  }

  ctx.put(outcome.result);

  try {
    // كلُّ ما صُرف يُسجَّل — حتى الفاشل: نداءات التوصيف والأسئلة دُفع ثمنها.
    await recordSpend(ctx.store, outcome.costMicros, ctx.deps.now());

    if (shouldCache(outcome.result, ctx.demo)) {
      await setCachedScan(ctx.store, input.domain, input.kind, input.scanId, {
        ttlHours: input.cacheTtlHours,
      });
    }
  } catch {
    // الدفتر سقط والنتيجة محفوظة. يُرصد هذا حين يصل Sentry (#6)؛ إلى ذلك
    // الحين، السقفُ الحقيقيّ هو الرصيد المدفوع مسبقاً عند المزوّد.
  }
}
