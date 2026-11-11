import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchResult } from '@wakeelcheck/core';
import { memoryStore } from '@wakeelcheck/limits';
import { checkCrawlers, domainFrom, handleCrawlerCheck, type Fetcher } from '../lib/crawler-check';

/**
 * الأداة المجانية: تقرأ robots.txt المنشور، وتفصل زواحف البحث المباشر عن
 * زواحف التدريب، ولا تُخفي فشل الجلب في «كلّه مسموح».
 */

const res = (status: number, body = ''): FetchResult => ({
  status,
  headers: {},
  body,
  ttfbMs: 1,
  finalUrl: 'https://x.sa/robots.txt',
  redirects: 0,
});
const serve = (status: number, body = ''): Fetcher => async () => res(status, body);

test('حظر التدريب وحده لا يُعدّ إخفاءً من البحث', async () => {
  const r = await checkCrawlers('x.sa', serve(200, 'User-agent: GPTBot\nDisallow: /\n'));
  assert.equal(r.robots, 'present');
  assert.deepEqual(r.blockedSearch, []);
  assert.equal(r.verdicts.find((v) => v.agent === 'GPTBot')?.allowed, false);
  assert.equal(r.verdicts.find((v) => v.agent === 'OAI-SearchBot')?.allowed, true);
});

test('حظر الكلّ يظهر في زواحف البحث بأسمائها', async () => {
  const r = await checkCrawlers('x.sa', serve(200, 'User-agent: *\nDisallow: /\n'));
  assert.ok(r.blockedSearch.includes('OAI-SearchBot'));
  assert.ok(r.blockedSearch.includes('Googlebot'));
});

test('لا ملف (404): لا قيد على أحد', async () => {
  const r = await checkCrawlers('x.sa', serve(404));
  assert.equal(r.robots, 'absent');
  assert.ok(r.verdicts.every((v) => v.allowed));
});

test('خطأ الخادم لا يُقرأ «كلّه مسموح»', async () => {
  await assert.rejects(checkCrawlers('x.sa', serve(500)));
  await assert.rejects(
    checkCrawlers('x.sa', async () => {
      throw new Error('net');
    })
  );
});

test('النطاق: يُقبل الاسم والرابط، ويُرفض العنوان الرقميّ والفارغ', () => {
  assert.equal(domainFrom('https://Shop.example.com/products'), 'shop.example.com');
  assert.equal(domainFrom('shop.sa'), 'shop.sa');
  assert.equal(domainFrom('127.0.0.1'), null);
  assert.equal(domainFrom(''), null);
});

const req = (q: string, ip = '203.0.113.9') =>
  new Request(`https://aitchek.online/api/tools/crawlers?${q}`, { headers: { 'x-forwarded-for': ip } });
const SALT = ['test', 'salt'].join('-');

test('المسار: 400 لنطاقٍ غير صالح، و200 بالتقرير', async () => {
  const deps = { fetch: serve(200, ''), store: memoryStore(), salt: SALT };
  assert.equal((await handleCrawlerCheck(req('domain='), deps)).status, 400);
  const ok = await handleCrawlerCheck(req('domain=shop.sa'), deps);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { domain: string }).domain, 'shop.sa');
});

test('المسار: حدٌّ لكلّ زائر، ثم 429', async () => {
  const deps = { fetch: serve(404), store: memoryStore(), salt: SALT, perHour: 2 };
  assert.equal((await handleCrawlerCheck(req('domain=a.sa'), deps)).status, 200);
  assert.equal((await handleCrawlerCheck(req('domain=a.sa'), deps)).status, 200);
  assert.equal((await handleCrawlerCheck(req('domain=a.sa'), deps)).status, 429);
  assert.equal((await handleCrawlerCheck(req('domain=a.sa', '198.51.100.4'), deps)).status, 200, 'زائرٌ آخر');
});

test('المسار: تعذّر جلب الملف 502، لا نتيجة كاذبة', async () => {
  const deps = { fetch: serve(503), store: memoryStore(), salt: SALT };
  assert.equal((await handleCrawlerCheck(req('domain=a.sa'), deps)).status, 502);
});
