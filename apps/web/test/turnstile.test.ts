import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleScanPost } from '../lib/scan-post';
import {
  VerificationUnavailableError,
  turnstileVerifier,
  verifierFromEnv,
} from '../lib/turnstile';
import { harness } from './fixture';

/**
 * #4 — إثبات الإنسان.
 *
 * ما يُحرَس هنا ثلاثة: أن البرنامج لا يمرّ، وأن رفضه لا يكلّف زائراً حقيقياً
 * شيئاً، وأن عطل التحقّق لا يُقرأ حكماً على الزائر.
 */

const SECRET = ['test', 'turnstile', 'secret'].join('-');

interface Seen {
  secret: string | null;
  response: string | null;
  remoteip: string | null;
}

/** Cloudflare وهميّ: رمزٌ واحد صالح، والباقي كما يرفضه Cloudflare. */
function fakeCloudflare(mode: 'normal' | 'network' | 'bad-secret' | 'garbage' = 'normal') {
  const seen: Seen[] = [];

  const handler = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    if (mode === 'network') throw new TypeError('fetch failed');
    if (mode === 'garbage') return new Response('<html>502</html>', { status: 502 });

    const form = new URLSearchParams(String(init?.body));
    seen.push({ secret: form.get('secret'), response: form.get('response'), remoteip: form.get('remoteip') });

    const reply = (body: object): Response => Response.json(body);
    if (mode === 'bad-secret' || form.get('secret') !== SECRET) {
      return reply({ success: false, 'error-codes': ['invalid-input-secret'] });
    }
    if (form.get('response') === 'human-token') return reply({ success: true, 'error-codes': [] });
    if (form.get('response') === 'used-token') {
      return reply({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    }
    return reply({ success: false, 'error-codes': ['invalid-input-response'] });
  };

  return { fetch: handler as typeof fetch, seen };
}

function scanRequest(body: object, ip = '203.0.113.7'): Request {
  return new Request('https://aitchek.online/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function guarded(cf = fakeCloudflare()) {
  const h = harness();
  h.deps.verifyHuman = turnstileVerifier({ secret: SECRET, fetch: cf.fetch });
  return { h, cf };
}

// ── المتحقّق وحده ────────────────────────────────────────────

test('الرمز الصالح يمرّ، ويُرسَل معه العنوان والمفتاح', async () => {
  const cf = fakeCloudflare();
  const verify = turnstileVerifier({ secret: SECRET, fetch: cf.fetch });

  assert.equal(await verify('human-token', '203.0.113.7'), 'ok');
  assert.deepEqual(cf.seen[0], { secret: SECRET, response: 'human-token', remoteip: '203.0.113.7' });
});

test('العنوان الافتراضيّ لا يُرسَل كأنه حقيقيّ', async () => {
  const cf = fakeCloudflare();
  await turnstileVerifier({ secret: SECRET, fetch: cf.fetch })('human-token', '0.0.0.0');

  assert.equal(cf.seen[0]?.remoteip, null);
});

test('رمزٌ غائب لا يُسأل عنه Cloudflare', async () => {
  const cf = fakeCloudflare();
  const verify = turnstileVerifier({ secret: SECRET, fetch: cf.fetch });

  assert.equal(await verify(undefined, '1.1.1.1'), 'missing');
  assert.equal(await verify('', '1.1.1.1'), 'missing');
  assert.equal(cf.seen.length, 0);
});

test('رمزٌ خاطئ أو مستعمَل يُرفض حكماً', async () => {
  const verify = turnstileVerifier({ secret: SECRET, fetch: fakeCloudflare().fetch });

  assert.equal(await verify('forged', '1.1.1.1'), 'failed');
  assert.equal(await verify('used-token', '1.1.1.1'), 'failed');
});

test('رمزٌ أطول من حدّ Cloudflare يُرفض بلا نداء', async () => {
  const cf = fakeCloudflare();
  assert.equal(await turnstileVerifier({ secret: SECRET, fetch: cf.fetch })('x'.repeat(2049), '1.1.1.1'), 'failed');
  assert.equal(cf.seen.length, 0);
});

test('عطلٌ عندنا لا يُقرأ «أنت روبوت»', async () => {
  // مفتاحٌ خاطئ أو شبكةٌ ساقطة أو ردٌّ غير مقروء: الخلل ليس عند الزائر.
  for (const mode of ['network', 'bad-secret', 'garbage'] as const) {
    const verify = turnstileVerifier({ secret: SECRET, fetch: fakeCloudflare(mode).fetch });
    await assert.rejects(verify('human-token', '1.1.1.1'), VerificationUnavailableError, mode);
  }
});

test('المفتاح السرّيّ لا يظهر في الخطأ', async () => {
  // القاعدة 01.
  const verify = turnstileVerifier({ secret: SECRET, fetch: fakeCloudflare('bad-secret').fetch });
  const err = await verify('human-token', '1.1.1.1').catch((e: unknown) => e);

  assert.ok(err instanceof Error);
  assert.ok(!err.message.includes(SECRET), err.message);
});

// ── من البيئة ────────────────────────────────────────────────

test('التحقّق يعمل فقط بالمفتاحين معاً', () => {
  // المفتاح السرّيّ وحده يطالب برمزٍ لن ترسله الواجهة — فيُرفض كلّ زائر.
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  assert.equal(verifierFromEnv(env({})), null);
  assert.equal(verifierFromEnv(env({ TURNSTILE_SECRET_KEY: SECRET })), null, 'السرّيّ وحده');
  assert.equal(verifierFromEnv(env({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site' })), null, 'العامّ وحده');
  assert.notEqual(
    verifierFromEnv(env({ TURNSTILE_SECRET_KEY: SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site' })),
    null
  );
});

// ── في المسار ────────────────────────────────────────────────

test('بلا رمز: 403، ولا فحص يُبدأ', async () => {
  const { h } = guarded();
  const res = await handleScanPost(scanRequest({ url: 'daralanaqa.sa' }), h.deps);

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'verification_required' });
  assert.equal(h.started(), 0);
});

test('برمزٍ مزوّر: 403، ولا فحص يُبدأ', async () => {
  const { h } = guarded();
  const res = await handleScanPost(scanRequest({ url: 'daralanaqa.sa', turnstileToken: 'forged' }), h.deps);

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'verification_failed' });
  assert.equal(h.started(), 0);
});

test('برمزٍ صالح: يمرّ كما كان', async () => {
  const { h } = guarded();
  const res = await handleScanPost(
    scanRequest({ url: 'daralanaqa.sa', turnstileToken: 'human-token' }),
    h.deps
  );

  assert.equal(res.status, 202);
  assert.equal(h.started(), 1);
});

test('البرنامج المرفوض لا يحرق رصيد زائرٍ حقيقيّ يشاركه العنوان', async () => {
  // مقهى، شبكة شركة، مزوّد جوّال: عنوانٌ واحد لكثيرين. لو استُهلك الرصيد
  // قبل التحقّق، لأنفق برنامجٌ فحوصَ جيرانه الثلاثة بمحاولاتٍ فاشلة.
  const { h } = guarded();
  for (let i = 0; i < 10; i++) {
    await handleScanPost(scanRequest({ url: `bot-${i}.sa`, turnstileToken: 'forged' }), h.deps);
  }

  const res = await handleScanPost(
    scanRequest({ url: 'daralanaqa.sa', turnstileToken: 'human-token' }),
    h.deps
  );
  // لو سبق الرصيدُ التحقّقَ، لنفد بعد ثلاث محاولاتٍ فاشلة وجاء هذا 429.
  assert.equal(res.status, 202, 'الإنسان بعد عشر محاولات فاشلة ما زال يملك رصيده');
});

test('تعذّر التحقّق يُغلق الباب', async () => {
  const { h } = guarded(fakeCloudflare('network'));
  const res = await handleScanPost(
    scanRequest({ url: 'daralanaqa.sa', turnstileToken: 'human-token' }),
    h.deps
  );

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'verification_unavailable' });
  assert.equal(h.started(), 0);
});

test('بلا متحقّق مُعدّ: لا يُطالب أحد برمز', async () => {
  // قبل أن يضبط الرئيس المفتاحين، الموقع يعمل كما كان.
  const h = harness();
  h.deps.verifyHuman = null;

  const res = await handleScanPost(scanRequest({ url: 'daralanaqa.sa' }), h.deps);
  assert.equal(res.status, 202);
});

test('رمزٌ ليس نصّاً يُعامَل غياباً', async () => {
  const { h } = guarded();
  const res = await handleScanPost(scanRequest({ url: 'daralanaqa.sa', turnstileToken: 42 }), h.deps);

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'verification_required' });
});
