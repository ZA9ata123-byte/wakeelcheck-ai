/**
 * النشرة إلى المشتركين — بعد كلّ قياسٍ ناجح.
 *
 * لكلّ بريدٍ رسالته بلغته. وفشلُ رسالةٍ لا يوقف الباقي، ولا يُفشل القياس:
 * القياس محفوظ والتقرير قائم برابطه، والرسالة تُعدّ فاشلةً فقط.
 */

import type { Digest } from '@wakeelcheck/core';
import type { SubscriptionLedger } from '@wakeelcheck/db';
import { ENTITLED } from './billing';
import { digestEmail, reportUrl, type Mailer } from './mailer';

export interface NotifyDeps {
  ledger: SubscriptionLedger | null;
  mailer: Mailer | null;
  /** `https://aitchek.online` — أصل الروابط في الرسالة. */
  site: string;
}

export interface NotifyResult {
  sent: number;
  failed: number;
  /** لماذا لم يُرسل شيء، إن لم يُرسل. */
  skipped?: 'no_mailer' | 'no_ledger' | 'no_recipients';
}

export async function notifyDigest(
  measured: { domain: string; reportId: string; digest: Digest },
  deps: NotifyDeps
): Promise<NotifyResult> {
  if (deps.mailer === null) return { sent: 0, failed: 0, skipped: 'no_mailer' };
  if (deps.ledger === null) return { sent: 0, failed: 0, skipped: 'no_ledger' };

  const recipients = await deps.ledger.recipients(measured.domain, [...ENTITLED]);
  if (recipients.length === 0) return { sent: 0, failed: 0, skipped: 'no_recipients' };

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const mail = digestEmail(measured.digest, {
      to: r.email,
      domain: measured.domain,
      url: reportUrl(deps.site, measured.reportId, r.locale),
      locale: r.locale,
    });
    try {
      await deps.mailer(mail);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
