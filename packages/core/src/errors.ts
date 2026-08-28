/**
 * أخطاء المنصة.
 *
 * كل خطأ يحمل `code` ثابتاً تقرؤه الواجهة، و`status` تستعمله طبقة HTTP.
 * الرسائل تمرّ على `redactText` حتى لا يتسرّب سرّ إلى سجلّ أو استجابة.
 */

import { redactText } from './redact.ts';

export type ErrorCode =
  | 'BLOCKED_HOST'
  | 'INVALID_URL'
  | 'FETCH_TIMEOUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'UPSTREAM_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_VERIFIED'
  | 'BUDGET_EXCEEDED';

export class WakeelError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 400) {
    super(redactText(message));
    this.name = 'WakeelError';
    this.code = code;
    this.status = status;
  }
}

/** الوجهة تحلّ إلى عنوان داخلي أو غير مسموح — حارس SSRF. */
export class BlockedHostError extends WakeelError {
  constructor(host: string, reason: string) {
    super('BLOCKED_HOST', `Blocked host "${host}": ${reason}`, 400);
    this.name = 'BlockedHostError';
  }
}

export class InvalidUrlError extends WakeelError {
  constructor(url: string) {
    super('INVALID_URL', `Invalid or unsupported URL: ${url}`, 400);
    this.name = 'InvalidUrlError';
  }
}

export class FetchTimeoutError extends WakeelError {
  constructor(url: string, ms: number) {
    super('FETCH_TIMEOUT', `Timed out after ${ms}ms fetching ${url}`, 504);
    this.name = 'FetchTimeoutError';
  }
}

export class PayloadTooLargeError extends WakeelError {
  constructor(url: string, maxBytes: number) {
    super('PAYLOAD_TOO_LARGE', `Response from ${url} exceeded ${maxBytes} bytes`, 413);
    this.name = 'PayloadTooLargeError';
  }
}

export class TooManyRedirectsError extends WakeelError {
  constructor(url: string, max: number) {
    super('TOO_MANY_REDIRECTS', `More than ${max} redirects from ${url}`, 400);
    this.name = 'TooManyRedirectsError';
  }
}

/** فشل مزوّد خارجي — نموذج، محرك بحث، أو واجهة طرف ثالث. */
export class UpstreamError extends WakeelError {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super('UPSTREAM_FAILED', `${provider}: ${message}`, 502);
    this.name = 'UpstreamError';
    this.provider = provider;
  }
}

/** الفحص العميق يتطلب ملكية مُثبتة — القاعدة الملزمة رقم 07. */
export class NotVerifiedError extends WakeelError {
  constructor(domain: string) {
    super('NOT_VERIFIED', `Ownership of ${domain} is not verified`, 403);
    this.name = 'NotVerifiedError';
  }
}

export function isWakeelError(err: unknown): err is WakeelError {
  return err instanceof WakeelError;
}
