/**
 * تشغيل المتابعة — قياسٌ واحد لمتجرٍ واحد، ونشرته.
 *
 * ## الأسئلة
 *
 * من أين تأتي أسئلة المتجر، بالترتيب:
 *
 * 1. المحفوظة في سجلّه — من الأسبوع الثاني فصاعداً، دائماً.
 * 2. أسئلة تقريره المجاني الأخير — **ما رآه التاجر بعينه**. «نراقب لك هذه
 *    الأسئلة نفسها كلّ أسبوع» وعدٌ يفهمه.
 * 3. وإلّا تُولَّد مرّةً (`PLANS.monitor.questions`) وتُحفظ.
 *
 * وما يُستعمل في القياس الأوّل يُحفظ، فلا يتبدّل بعده.
 *
 * ## لا يُرمى
 *
 * يُستدعى من مهمّةٍ مجدولة لا يراها أحد. كلّ فشلٍ يُعاد قيمةً تقول ما حدث،
 * والقياس يُسجَّل حتى حين يفشل — وإلّا بقي المتجر المعطوب أوّل المستحقّين
 * إلى الأبد، وحجب كلّ من بعده.
 */

import type { BuyingQuestion, Digest, ScanResult } from '@wakeelcheck/core';
import type { Monitor, MonitorRegistry, ScanArchive } from '@wakeelcheck/db';
import { recordSpend, type KeyValueStore } from '@wakeelcheck/limits';
import {
  baselineDigest,
  diffScans,
  runScan,
  weeklyDigest,
  type PipelineDeps,
  type ScanOutcome,
  type ScanRequest,
} from '@wakeelcheck/pipeline';
import { saveResult } from './store';

export interface MonitorDeps {
  registry: MonitorRegistry;
  archive: ScanArchive;
  store: KeyValueStore;
  pipeline: PipelineDeps;
  /** `runScan` في الإنتاج. */
  run?: (req: ScanRequest, deps: PipelineDeps) => Promise<ScanOutcome>;
  budgetMs: number;
  now(): Date;
  newId(): string;
}

export type MonitorOutcome =
  | { status: 'measured'; domain: string; reportId: string; digest: Digest }
  | { status: 'failed'; domain: string; reportId: string; error: string };

/** أسئلة القياس: المحفوظة، ثم أسئلة التقرير المجاني الأخير، ثم لا شيء فتُولَّد. */
async function questionsFor(m: Monitor, archive: ScanArchive): Promise<BuyingQuestion[] | undefined> {
  if (m.questions !== null && m.questions.length > 0) return m.questions;

  const [free] = await archive.history(m.domain, 'quick', 1);
  if (free !== undefined && free.questions.length > 0) return free.questions;

  return undefined;
}

export async function runMonitor(m: Monitor, deps: MonitorDeps): Promise<MonitorOutcome> {
  const run = deps.run ?? runScan;
  const reportId = deps.newId();
  const at = deps.now();

  let outcome: ScanOutcome;
  try {
    const questions = await questionsFor(m, deps.archive);
    outcome = await run(
      questions === undefined
        ? { url: m.url, kind: 'monitor', budgetMs: deps.budgetMs }
        : { url: m.url, kind: 'monitor', budgetMs: deps.budgetMs, questions },
      { ...deps.pipeline, newId: () => reportId }
    );
  } catch (err) {
    await deps.registry.markRun(m.domain, at, reportId).catch(() => {});
    return { status: 'failed', domain: m.domain, reportId, error: message(err) };
  }

  // كلّ ما صُرف يُحسب على السقف الشهريّ — المتابعة تُنفق كما يُنفق الفحص.
  await recordSpend(deps.store, outcome.costMicros, at).catch(() => {});

  const result = outcome.result;
  if (result.status !== 'done') {
    await deps.registry.markRun(m.domain, at, reportId).catch(() => {});
    return { status: 'failed', domain: m.domain, reportId, error: result.error ?? 'scan failed' };
  }

  try {
    // الأسئلة تُثبَّت عند أوّل قياس، ولا يُكتب فوقها بعده.
    if (m.questions === null) await deps.registry.setQuestions(m.domain, result.questions);

    // الماضي قبل الحاضر: يُقرأ قبل أن يُحفظ هذا القياس، فلا يُقارَن بنفسه.
    const [previous] = await deps.archive.history(m.domain, 'monitor', 1);

    await deps.archive.save({ domain: m.domain, result, costMicros: outcome.costMicros, at });

    const digest =
      previous === undefined
        ? baselineDigest(m.domain, result.questions.length)
        : weeklyDigest(diffScans(previous, result), m.domain);

    await deps.registry.saveDigest({ reportId, domain: m.domain, digest, at });
    await deps.registry.markRun(m.domain, at, reportId);

    // ورابط التقرير يعمل فوراً، لا بعد أن يُقرأ من الأرشيف.
    await saveResult(deps.store, { ...result, digest } satisfies ScanResult).catch(() => {});

    return { status: 'measured', domain: m.domain, reportId, digest };
  } catch (err) {
    await deps.registry.markRun(m.domain, at, reportId).catch(() => {});
    return { status: 'failed', domain: m.domain, reportId, error: message(err) };
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : 'monitor failed');
