import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSecurity,
  headlineFinding,
  type SecurityInput,
} from '../src/evaluate.ts';

const NOW = new Date('2026-08-27T00:00:00Z');

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

/** متجر سليم تماماً — خط الأساس الذي لا يُنتج أي نتيجة. */
function clean(over: Partial<SecurityInput> = {}): SecurityInput {
  return {
    domain: 'shop.sa',
    now: NOW,
    domainInfo: { expiresAt: daysFromNow(300) },
    cert: { expiresAt: daysFromNow(80), protocol: 'TLSv1.3' },
    mail: { spf: 'v=spf1 include:_spf.google.com ~all', dmarc: 'v=DMARC1; p=reject' },
    headers: {
      'strict-transport-security': 'max-age=63072000',
      'content-security-policy': "default-src 'self'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin',
    },
    https: true,
    html: '<html><body><img src="https://cdn.shop.sa/a.jpg"></body></html>',
    jsAssets: [],
    danglingCnames: [],
    ...over,
  };
}

const kinds = (input: SecurityInput): string[] => evaluateSecurity(input).map((f) => f.kind);

test('a well-configured store produces no findings', () => {
  assert.deepEqual(evaluateSecurity(clean()), []);
});

// ── انتهاء النطاق ────────────────────────────────────────────

test('a domain expiring soon is reported with the day count', () => {
  const findings = evaluateSecurity(clean({ domainInfo: { expiresAt: daysFromNow(34) } }));
  const domain = findings.find((f) => f.kind === 'domain_expiry');

  assert.equal(domain?.severity, 'high');
  assert.equal(domain?.title.ar, 'نطاقك ينتهي بعد 34 يوماً');
  assert.match(domain?.evidence ?? '', /RDAP expiry/);
});

test('domain expiry severity rises as the date approaches', () => {
  const at = (days: number) =>
    evaluateSecurity(clean({ domainInfo: { expiresAt: daysFromNow(days) } })).find(
      (f) => f.kind === 'domain_expiry'
    );

  assert.equal(at(90), undefined, 'far out: not worth alarming');
  assert.equal(at(55)?.severity, 'medium');
  assert.equal(at(34)?.severity, 'high', 'the headline case');
  assert.equal(at(20)?.severity, 'high');
  assert.equal(at(10)?.severity, 'critical');
  assert.equal(at(-3)?.severity, 'critical');
});

test('an already expired domain says so plainly', () => {
  const finding = evaluateSecurity(clean({ domainInfo: { expiresAt: daysFromNow(-5) } })).find(
    (f) => f.kind === 'domain_expiry'
  );

  assert.equal(finding?.title.ar, 'نطاقك منتهٍ');
});

test('an unavailable RDAP lookup reports nothing rather than guessing', () => {
  assert.ok(!kinds(clean({ domainInfo: { expiresAt: null } })).includes('domain_expiry'));
});

test('an unparseable expiry date is ignored', () => {
  assert.ok(!kinds(clean({ domainInfo: { expiresAt: 'not-a-date' } })).includes('domain_expiry'));
});

// ── الشهادة ──────────────────────────────────────────────────

test('a certificate expiring within three weeks is reported', () => {
  const finding = evaluateSecurity(
    clean({ cert: { expiresAt: daysFromNow(11), protocol: 'TLSv1.3' } })
  ).find((f) => f.kind === 'tls_expiry');

  assert.equal(finding?.severity, 'high');
  assert.match(finding?.title.ar ?? '', /11 يوماً/);
});

test('a healthy certificate is not reported', () => {
  assert.ok(!kinds(clean()).includes('tls_expiry'));
});

test('an outdated TLS protocol is flagged', () => {
  const finding = evaluateSecurity(
    clean({ cert: { expiresAt: daysFromNow(200), protocol: 'TLSv1.1' } })
  ).find((f) => f.kind === 'tls_expiry');

  assert.equal(finding?.title.en, 'Outdated TLS protocol');
});

// ── انتحال البريد ────────────────────────────────────────────

test('a missing DMARC record is high severity', () => {
  const finding = evaluateSecurity(
    clean({ mail: { spf: 'v=spf1 ~all', dmarc: null } })
  ).find((f) => f.kind === 'no_dmarc');

  assert.equal(finding?.severity, 'high');
  assert.match(finding?.detail.ar ?? '', /أي شخص يستطيع إرسال بريد باسم متجرك/);
});

test('DMARC set to p=none is reported as not enforcing', () => {
  const finding = evaluateSecurity(
    clean({ mail: { spf: 'v=spf1 ~all', dmarc: 'v=DMARC1; p=none; rua=mailto:x@shop.sa' } })
  ).find((f) => f.kind === 'no_dmarc');

  assert.equal(finding?.severity, 'medium');
  assert.equal(finding?.title.en, 'DMARC policy is not enforcing');
});

test('p=quarantine and p=reject both count as enforcing', () => {
  for (const policy of ['v=DMARC1; p=quarantine', 'v=DMARC1;p=reject;pct=100']) {
    assert.ok(
      !kinds(clean({ mail: { spf: 'v=spf1 ~all', dmarc: policy } })).includes('no_dmarc'),
      `${policy} should pass`
    );
  }
});

test('a missing SPF record is reported', () => {
  assert.ok(kinds(clean({ mail: { spf: null, dmarc: 'v=DMARC1; p=reject' } })).includes('no_spf'));
});

// ── الأسرار المكشوفة ─────────────────────────────────────────

const LIVE_KEY = ['sk', 'live', 'A1b2C3d4E5f6G7h8J9k0Lm4f2a'].join('_');

test('a key exposed in a public bundle is critical and located', () => {
  const findings = evaluateSecurity(
    clean({
      jsAssets: [{ url: 'https://shop.sa/app.js', text: `\n\n\nconst k="${LIVE_KEY}";` }],
    })
  );
  const secret = findings.find((f) => f.kind === 'exposed_secret');

  assert.equal(secret?.severity, 'critical');
  assert.match(secret?.evidence ?? '', /app\.js:4/, 'line number should be reported');
});

test('an exposed key is never reported in full — rule 01', () => {
  const findings = evaluateSecurity(
    clean({ jsAssets: [{ url: 'https://shop.sa/app.js', text: `const k="${LIVE_KEY}";` }] })
  );

  for (const finding of findings) {
    assert.ok(!finding.evidence.includes(LIVE_KEY), 'evidence must never carry the full value');
    assert.ok(!JSON.stringify(finding).includes(LIVE_KEY), 'nor any other field');
  }
});

test('the exposed secret outranks every other finding', () => {
  const findings = evaluateSecurity(
    clean({
      domainInfo: { expiresAt: daysFromNow(3) },
      jsAssets: [{ url: 'https://shop.sa/app.js', text: `const k="${LIVE_KEY}";` }],
    })
  );

  assert.equal(headlineFinding(findings)?.kind, 'exposed_secret');
});

// ── محتوى مختلط وكوكيز ───────────────────────────────────────

test('http resources inside an https page are counted', () => {
  const finding = evaluateSecurity(
    clean({ html: '<img src="http://a.com/1.jpg"><script src="http://b.com/x.js">' })
  ).find((f) => f.kind === 'mixed_content');

  assert.match(finding?.title.ar ?? '', /^2 مورداً/);
});

test('mixed content is irrelevant on an http page', () => {
  assert.ok(
    !kinds(clean({ https: false, html: '<img src="http://a.com/1.jpg">' })).includes('mixed_content')
  );
});

test('cookies missing protection flags are reported', () => {
  const finding = evaluateSecurity(
    clean({ headers: { ...clean().headers, 'set-cookie': 'sid=abc; Path=/' } })
  ).find((f) => f.kind === 'cookie_flags');

  assert.equal(finding?.evidence, 'missing: Secure, HttpOnly, SameSite');
});

test('fully flagged cookies are not reported', () => {
  assert.ok(
    !kinds(
      clean({
        headers: {
          ...clean().headers,
          'set-cookie': 'sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax',
        },
      })
    ).includes('cookie_flags')
  );
});

// ── الترويسات والنطاقات المهجورة ────────────────────────────

test('missing security headers are grouped into one finding', () => {
  const findings = evaluateSecurity(clean({ headers: {} }));
  const header = findings.filter((f) => f.kind === 'missing_headers');

  assert.equal(header.length, 1, 'one finding, not four');
  assert.equal(header[0]?.evidence, 'HSTS, CSP, X-Content-Type-Options, Referrer-Policy');
});

test('a dangling CNAME is reported per host', () => {
  const findings = evaluateSecurity(
    clean({ danglingCnames: ['old.shop.sa', 'blog.shop.sa'] })
  ).filter((f) => f.kind === 'dangling_cname');

  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.severity, 'high');
});

// ── الترتيب ──────────────────────────────────────────────────

test('findings are ordered by severity', () => {
  const findings = evaluateSecurity(
    clean({
      headers: {},
      domainInfo: { expiresAt: daysFromNow(5) },
      mail: { spf: null, dmarc: null },
    })
  );

  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  for (let i = 1; i < findings.length; i++) {
    const prev = findings[i - 1];
    const cur = findings[i];
    assert.ok(prev !== undefined && cur !== undefined);
    assert.ok(rank[prev.severity] <= rank[cur.severity], 'severity must not increase down the list');
  }
});

test('headlineFinding returns null when the store is clean', () => {
  assert.equal(headlineFinding(evaluateSecurity(clean())), null);
});

test('every finding carries both languages', () => {
  const findings = evaluateSecurity(
    clean({
      headers: {},
      domainInfo: { expiresAt: daysFromNow(5) },
      cert: { expiresAt: daysFromNow(2), protocol: 'TLSv1.0' },
      mail: { spf: null, dmarc: null },
      danglingCnames: ['old.shop.sa'],
      html: '<img src="http://a.com/1.jpg">',
    })
  );

  assert.ok(findings.length >= 6);
  for (const finding of findings) {
    assert.ok(finding.title.ar.length > 0 && finding.title.en.length > 0, finding.kind);
    assert.ok(finding.detail.ar.length > 0 && finding.detail.en.length > 0, finding.kind);
    assert.ok(finding.evidence.length > 0, finding.kind);
  }
});
