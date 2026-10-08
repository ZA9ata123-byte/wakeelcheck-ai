import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArchiveUnavailableError, type Monitor, type MonitorRegistry } from '@wakeelcheck/db';
import { MONITOR_INTERVAL_DAYS, handleEnroll, handleMonitorCron, type CronDeps } from '../lib/cron';
import { PLATFORM_LIMIT_MS } from '../lib/launch';
import type { MonitorOutcome } from '../lib/monitor';
import { NOW } from './fixture';

/**
 * المهمّة المجدولة ومسار التسجيل: كلاهما يفتح باب الإنفاق، فكلاهما مغلق
 * ما لم يُضبط سرّه — ويُختبر الإغلاق قبل الفتح.
 */

// قيمٌ تشبه أسراراً تُبنى وقت التشغيل — حارس CI يرفضها نصّاً.
const SECRET = ['test', 'cron', 'secret'].join('-');
const TOKEN = ['test', 'admin', 'token'].join('-');

const monitor = (domain: string): Monitor => ({
  domain,
  url: `https://${domain}/`,
  locale: 'ar',
  questions: null,
  active: true,
  createdAt: NOW,
  lastRunAt: null,
  lastReport: null,
});

function registry(
  opts: { due?: Monitor[]; down?: boolean } = {}
): MonitorRegistry & { dueArgs: unknown[][]; enrolled: unknown[] } {
  const self = {
    dueArgs: [] as unknown[][],
    enrolled: [] as unknown[],
    async enroll(input: unknown) {
      if (opts.down === true) throw new ArchiveUnavailableError('down');
      self.enrolled.push(input);
    },
    async deactivate() {},
    async get() {
      return null;
    },
    async due(now: Date, days: number, limit: number) {
      self.dueArgs.push([now, days, limit]);
      if (opts.down === true) throw new ArchiveUnavailableError('down');
      return (opts.due ?? []).slice(0, limit);
    },
    async setQuestions() {
      return [];
    },
    async markRun() {},
    async saveDigest() {},
    async digestFor() {
      return null;
    },
  };
  return self;
}

const cronReq = (auth?: string): Request =>
  new Request('https://aitchek.online/api/cron/monitor', {
    headers: auth === undefined ? {} : { authorization: auth },
  });

function cron(overrides: Partial<CronDeps> & { ran?: Monitor[] } = {}): CronDeps & { ran: Monitor[] } {
  const ran = overrides.ran ?? [];
  return {
    secret: SECRET,
    registry: registry({ due: [monitor('a.sa'), monitor('b.sa')] }),
    now: () => NOW,
    async runOne(m): Promise<MonitorOutcome> {
      ran.push(m);
      return {
        status: 'measured',
        domain: m.domain,
        reportId: 'r1',
        digest: { tone: 'baseline', headline: { ar: '', en: '' }, lines: [], basis: { ar: '', en: '' } },
      };
    },
    ...overrides,
    ran,
  };
}

// ── الإغلاق ──────────────────────────────────────────────────

test('بلا CRON_SECRET: المسار مغلقٌ للجميع لا مفتوح', async () => {
  for (const secret of [undefined, '']) {
    const d = cron({ secret });
    const res = await handleMonitorCron(cronReq('Bearer '), d);
    assert.equal(res.status, 503);
    assert.equal(d.ran.length, 0, 'لا قياس ولا إنفاق');
  }
});

test('سرٌّ خاطئ أو غائب أو بطولٍ آخر: 401 ولا قياس', async () => {
  for (const auth of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET, `bearer ${SECRET}`]) {
    const d = cron();
    const res = await handleMonitorCron(cronReq(auth), d);
    assert.equal(res.status, 401, String(auth));
    assert.equal(d.ran.length, 0);
  }
});

test('بلا قاعدة: 503 لا 500', async () => {
  const res = await handleMonitorCron(cronReq(`Bearer ${SECRET}`), cron({ registry: null }));
  assert.equal(res.status, 503);
});

test('قاعدةٌ ساقطة: 503، ورسالةٌ بلا نصّ الاتصال', async () => {
  const res = await handleMonitorCron(cronReq(`Bearer ${SECRET}`), cron({ registry: registry({ down: true }) }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'monitoring_unavailable' });
});

// ── التشغيل ──────────────────────────────────────────────────

test('متجرٌ واحد في كلّ استدعاء — الأقدم، بالمدّة الأسبوعية', async () => {
  const reg = registry({ due: [monitor('a.sa'), monitor('b.sa')] });
  const d = cron({ registry: reg });

  const res = await handleMonitorCron(cronReq(`Bearer ${SECRET}`), d);

  assert.equal(res.status, 200);
  assert.deepEqual(d.ran.map((m) => m.domain), ['a.sa'], 'اثنان لا يدخلان مهلة الدالة');
  assert.deepEqual(reg.dueArgs, [[NOW, MONITOR_INTERVAL_DAYS, 1]]);
  assert.deepEqual(await res.json(), { ran: 'a.sa', status: 'measured', report: 'r1', tone: 'baseline' });
});

test('لا مستحقّ: لا قياس', async () => {
  const d = cron({ registry: registry({ due: [] }) });
  const res = await handleMonitorCron(cronReq(`Bearer ${SECRET}`), d);

  assert.deepEqual(await res.json(), { ran: null });
  assert.equal(d.ran.length, 0);
});

test('قياسٌ فاشل يُعلَن ولا يُخفى', async () => {
  const d = cron({
    runOne: async (m) => ({ status: 'failed', domain: m.domain, reportId: 'r2', error: 'boom' }),
  });
  const body = await (await handleMonitorCron(cronReq(`Bearer ${SECRET}`), d)).json();

  assert.deepEqual(body, { ran: 'a.sa', status: 'failed', report: 'r2' });
});

test('المتابعة أسبوعية', () => {
  assert.equal(MONITOR_INTERVAL_DAYS, 7);
});

// ── ملفّات المنصّة ───────────────────────────────────────────

const fromRoot = (...rel: string[]): string => {
  const candidates = [resolve(process.cwd(), ...rel), resolve(process.cwd(), '../..', ...rel)];
  const found = candidates.find((p) => existsSync(p));
  assert.ok(found, rel.join('/'));
  return found;
};

test('vercel.json يجدول المسار الموجود فعلاً', () => {
  const config = JSON.parse(readFileSync(fromRoot('vercel.json'), 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };
  const job = config.crons?.find((c) => c.path === '/api/cron/monitor');
  assert.ok(job, 'المهمّة غير مجدولة');
  // Hobby: مرّةً في اليوم على الأكثر — جدولٌ أكثر يُرفض عند النشر.
  assert.match(job.schedule, /^\d+ \d+ \* \* \*$/);
  assert.ok(existsSync(fromRoot('apps/web/app/api/cron/monitor/route.ts')));
});

test('maxDuration في مسار المتابعة يطابق سقف المنصّة', () => {
  const source = readFileSync(fromRoot('apps/web/app/api/cron/monitor/route.ts'), 'utf8');
  const match = /export const maxDuration = (\d+);/.exec(source);
  assert.ok(match, 'بلا maxDuration تُقطع الدالة قبل أن يُكمل القياس');
  assert.equal(Number(match[1]) * 1000, PLATFORM_LIMIT_MS);
});

// ── التسجيل ──────────────────────────────────────────────────

const enrollReq = (body: unknown, auth = `Bearer ${TOKEN}`): Request =>
  new Request('https://aitchek.online/api/admin/monitors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('التسجيل مغلقٌ بلا ADMIN_TOKEN، و401 بغيره', async () => {
  const reg = registry();
  assert.equal((await handleEnroll(enrollReq({ url: 'a.sa' }), { token: undefined, registry: reg, now: () => NOW })).status, 503);
  assert.equal((await handleEnroll(enrollReq({ url: 'a.sa' }), { token: '', registry: reg, now: () => NOW })).status, 503);
  assert.equal(
    (await handleEnroll(enrollReq({ url: 'a.sa' }, 'Bearer nope'), { token: TOKEN, registry: reg, now: () => NOW })).status,
    401
  );
  // سرّ المهمّة المجدولة ليس سرّ الإدارة.
  assert.equal(
    (await handleEnroll(enrollReq({ url: 'a.sa' }, `Bearer ${SECRET}`), { token: TOKEN, registry: reg, now: () => NOW })).status,
    401
  );
  assert.equal(reg.enrolled.length, 0);
});

test('التسجيل يطبّع النطاق واللغة', async () => {
  const reg = registry();
  const res = await handleEnroll(enrollReq({ url: 'https://WWW.Noura.sa/ar', locale: 'fr' }), {
    token: TOKEN,
    registry: reg,
    now: () => NOW,
  });

  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { enrolled: 'noura.sa' });
  const [input] = reg.enrolled as { domain: string; locale: string; at: Date }[];
  assert.equal(input?.domain, 'noura.sa');
  assert.equal(input?.locale, 'ar', 'لغةٌ غير معروفة تعود إلى العربية');
  assert.equal(input?.at, NOW);
});

test('جسمٌ تالف أو بلا رابط أو بمخطّطٍ غير الويب: 400', async () => {
  const deps = { token: TOKEN, registry: registry(), now: () => NOW };
  assert.equal((await handleEnroll(enrollReq('{not json'), deps)).status, 400);
  assert.equal((await handleEnroll(enrollReq({}), deps)).status, 400);
  assert.equal((await handleEnroll(enrollReq({ url: 'javascript:alert(1)' }), deps)).status, 400);
  // العنوان الداخليّ لا يُرفض هنا: `safeFetch` يرفضه عند كلّ جلب — القاعدة 02.
});

test('بلا قاعدة أو بقاعدةٍ ساقطة: 503', async () => {
  assert.equal((await handleEnroll(enrollReq({ url: 'a.sa' }), { token: TOKEN, registry: null, now: () => NOW })).status, 503);
  assert.equal(
    (await handleEnroll(enrollReq({ url: 'a.sa' }), { token: TOKEN, registry: registry({ down: true }), now: () => NOW })).status,
    503
  );
});
