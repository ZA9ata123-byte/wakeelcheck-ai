/**
 * إثبات الإنسان — #4.
 *
 * الحدّ يمنع الزائر الواحد من الإفراط. ولا يمنع برنامجاً يبدّل عنوانه مع كل
 * طلب: ألف عنوان = ثلاثة آلاف فحصٍ مدفوع. Turnstile يسأل «هل أنت إنسان؟»
 * قبل أن يُسأل أيّ شيءٍ آخر، وأغلب الزوّار لا يرون شيئاً.
 *
 * ## الترتيب
 *
 * التحقّق **قبل** `admit`: برنامجٌ يُرفض لا يحرق رصيد زائرٍ حقيقيّ يشاركه
 * العنوان، ولا يصل إلى الكاش ولا إلى السقف.
 *
 * ## يعمل فقط حين يكتمل زوجه
 *
 * المفتاح السرّيّ وحده يعني أن الخادم يطلب رمزاً لن ترسله الواجهة أبداً —
 * فيُرفض كلّ زائر. فلا يُفعَّل التحقّق إلا بالمفتاحين معاً، و`/api/health`
 * يُعلن حاله.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare لا يقبل رمزاً أطول من هذا. */
const MAX_TOKEN = 2048;

export type HumanCheck = 'ok' | 'missing' | 'failed';

export type HumanVerifier = (token: string | undefined, ip: string) => Promise<HumanCheck>;

/**
 * التحقّق نفسه تعذّر — لا أن الزائر أخفق فيه.
 *
 * يُفرَّق بينهما لأن الأول عطلٌ عندنا أو عند Cloudflare، والثاني حكمٌ على
 * الزائر. ولا يحمل المفتاح في رسالته — القاعدة 01.
 */
export class VerificationUnavailableError extends Error {
  constructor(detail: string) {
    super(`human verification unavailable: ${detail}`);
    this.name = 'VerificationUnavailableError';
  }
}

/**
 * رموز خطأ تعني أن الخلل عندنا لا عند الزائر: مفتاحٌ سرّيّ غائب أو خاطئ،
 * أو عطلٌ داخل Cloudflare. رفضُ الزائر بسببها يُخفي عطلاً تحت «أنت روبوت».
 */
const OUR_FAULT = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

export interface TurnstileOptions {
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function turnstileVerifier(opts: TurnstileOptions): HumanVerifier {
  const send = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  return async (token, ip) => {
    if (token === undefined || token === '') return 'missing';
    if (token.length > MAX_TOKEN) return 'failed';

    const form = new URLSearchParams({ secret: opts.secret, response: token });
    // العنوان يساعد Cloudflare في الحكم. والافتراضيّ ليس عنواناً حقيقياً.
    if (ip !== '0.0.0.0') form.set('remoteip', ip);

    let res: Response;
    try {
      res = await send(SITEVERIFY, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new VerificationUnavailableError(err instanceof Error ? err.name : 'network');
    }

    let data: { success?: unknown; 'error-codes'?: unknown };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new VerificationUnavailableError(`HTTP ${res.status}`);
    }

    if (data.success === true) return 'ok';

    const codes = Array.isArray(data['error-codes'])
      ? data['error-codes'].filter((c): c is string => typeof c === 'string')
      : [];
    if (codes.some((c) => OUR_FAULT.has(c))) {
      throw new VerificationUnavailableError(codes.join(','));
    }

    // رمزٌ خاطئ أو منتهٍ أو مستعمَل قبلاً — حكمٌ على الطلب لا عطل.
    return 'failed';
  };
}

/**
 * المتحقّق من البيئة، أو `null` حين لا يكتمل الزوج.
 *
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` تقرؤه الواجهة؛ والخادم يقرؤه هنا ليتأكّد
 * أن الواجهة سترسل رمزاً فعلاً قبل أن يطالب به.
 */
export function verifierFromEnv(
  env: (name: string) => string | undefined,
  fetchImpl?: typeof fetch
): HumanVerifier | null {
  const secret = env('TURNSTILE_SECRET_KEY');
  const siteKey = env('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  if (secret === undefined || secret === '' || siteKey === undefined || siteKey === '') return null;

  return turnstileVerifier(fetchImpl === undefined ? { secret } : { secret, fetch: fetchImpl });
}
