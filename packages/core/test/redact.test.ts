import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  containsSecret,
  findSecrets,
  maskSecret,
  redactText,
} from '../src/redact.ts';

/**
 * القيم الاصطناعية تُركَّب وقت التشغيل عمداً.
 *
 * كتابتها كنصوص كاملة يجعلها تطابق أنماط أسرار حقيقية، فتحجبها حماية الدفع
 * في GitHub — وهي محقّة في ذلك. التركيب يُبقي الاختبار واقعياً بلا أن يحمل
 * المستودع شيئاً يشبه مفتاحاً.
 */
const STRIPE_BODY = 'A1b2C3d4E5f6G7h8J9k0Lm4f2a';
const STRIPE = ['sk', 'live', STRIPE_BODY].join('_');
const AWS = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const GOOGLE = ['AIza', 'SyD', '1234567890abcdefghijklmnopqrstuv'].join('');
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
].join('.');
const PUBLISHABLE = ['pk', 'live', 'A1b2C3d4E5f6G7h8J9k0Lm'].join('_');

test('maskSecret keeps a recognisable head and tail only', () => {
  const masked = maskSecret(STRIPE);

  assert.ok(masked.startsWith('sk_live'), 'prefix should survive for identification');
  assert.ok(masked.endsWith('4f2a'), 'last four should survive');
  assert.ok(!masked.includes(STRIPE_BODY), 'body must not survive');
  assert.ok(masked.includes('•'), 'masked body should be dotted');
});

test('maskSecret fully hides short values', () => {
  assert.equal(maskSecret('short'), '••••••••');
  assert.equal(maskSecret('abcdefghijk'), '••••••••', '11 chars is still short');
});

test('maskSecret never returns the original value', () => {
  for (const secret of [STRIPE, AWS, GOOGLE, 'ghp_' + 'a'.repeat(36)]) {
    assert.notEqual(maskSecret(secret), secret);
  }
});

test('findSecrets detects the kinds that show up in store bundles', () => {
  const bundle = `
    const stripe = "${STRIPE}";
    const aws = "${AWS}";
    const gmaps = "${GOOGLE}";
  `;

  const kinds = findSecrets(bundle).map((hit) => hit.kind);

  assert.ok(kinds.includes('stripe_secret'));
  assert.ok(kinds.includes('aws_access_key'));
  assert.ok(kinds.includes('google_api_key'));
});

test('findSecrets ignores publishable keys — they are not secrets', () => {
  assert.equal(findSecrets(`const pk = "${PUBLISHABLE}";`).length, 0);
});

test('findSecrets never returns an unmasked value', () => {
  const bundle = `a="${STRIPE}"; b="${AWS}"; c="${GOOGLE}";`;

  for (const hit of findSecrets(bundle)) {
    assert.ok(hit.masked.includes('•'), 'every hit must carry mask characters');
    assert.notEqual(hit.masked, STRIPE);
    assert.notEqual(hit.masked, AWS);
    assert.notEqual(hit.masked, GOOGLE);
  }
});

test('findSecrets deduplicates repeats of the same key', () => {
  assert.equal(findSecrets(`${STRIPE} ... ${STRIPE} ... ${STRIPE}`).length, 1);
});

test('redactText strips every secret out of a blob', () => {
  const raw = `key=${STRIPE} aws=${AWS} maps=${GOOGLE}`;
  const clean = redactText(raw);

  assert.ok(!clean.includes(STRIPE));
  assert.ok(!clean.includes(AWS));
  assert.ok(!clean.includes(GOOGLE));
  assert.equal(containsSecret(clean), false, 'redacted output must be clean');
});

test('redactText leaves ordinary text untouched', () => {
  const plain = 'متجر عبايات في الرياض — التوصيل خلال 24 ساعة';
  assert.equal(redactText(plain), plain);
});

test('redactText handles private key blocks and JWTs', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----';

  assert.ok(!redactText(JWT).includes(JWT));
  assert.ok(!redactText(pem).includes(pem));
});
