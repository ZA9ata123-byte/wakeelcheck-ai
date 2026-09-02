/**
 * يفحص دفعة متاجر حقيقية ويُبرز ما يستحق النظر.
 *
 *   pnpm run review stores.txt
 *   pnpm run review stores.txt --max-usd 2
 *
 * الملف: نطاق في كل سطر. السطور الفارغة وما يبدأ بـ`#` تُتجاهَل.
 *
 * ## لماذا
 *
 * البوّابة قبل أوّل تاجر هي «افحص عشرين متجراً واقرأ كل تقرير». بلا أداة
 * تعني أربعمئة صفّ بالعين. وأكثرها لا يحتاج نظراً: ما يحتاجه هو القاعدة
 * التي نجحت على العشرين كلّها أو أخفقت عليها كلّها.
 *
 * الأولى لم تفرّق بين متجرين فهي تُضخّم النتيجة. والثانية إمّا مكسورة
 * وإمّا مقيَّمة في الموضع الخطأ — وهو ما حدث فعلاً حين كانت قواعد المنتج
 * تُقيَّم على الصفحة الرئيسية.
 *
 * ## ما يعمل بلا مفاتيح
 *
 * الجاهزية والأمن والتوصيف كلّها من `safeFetch` وRDAP وTLS وDNS. المحجوب
 * هو نداء المحرّك وحده، فيُترك فارغاً ويُعلَّم كذلك — لا يُعرض غياباً.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Engine, FetchResult, RuleResult, ScanResult } from '../packages/core/src/index.ts';
import { safeFetch } from '../packages/fetcher/src/index.ts';
import { collectSecurity } from '../packages/security/src/index.ts';
import { auditRules, type BatchAudit } from '../packages/readiness/src/index.ts';
import { runScan, type PipelineDeps, type SecurityCollected } from '../packages/pipeline/src/index.ts';
import {
  fakeProvider,
  oxAlpha,
  deepSeekFlash,
  withFallback,
  type LlmProvider,
} from '../packages/llm/src/index.ts';
import { buildEngines, type EngineClient } from '../packages/engines/src/index.ts';

// ── المدخل ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith('--'));
const maxUsdArg = args[args.indexOf('--max-usd') + 1];
const MAX_USD = args.includes('--max-usd') ? Number(maxUsdArg) : 5;

if (listPath === undefined) {
  console.error('الاستعمال: pnpm run review <ملف-النطاقات> [--max-usd 2]');
  process.exit(1);
}

const domains = readFileSync(listPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => l.replace(/^https?:\/\//, '').replace(/\/$/, ''));

if (domains.length === 0) {
  console.error('لا نطاقات في الملف.');
  process.exit(1);
}

// ── التبعيات ─────────────────────────────────────────────────

function buildLlm(): { llm: LlmProvider; live: boolean } {
  const openrouter = process.env['OPENROUTER_API_KEY'] ?? null;
  const deepseek = process.env['DEEPSEEK_API_KEY'] ?? null;

  if (openrouter === null && deepseek === null) {
    // بلا مفاتيح: التوصيف والأسئلة ثابتة، والجاهزية والأمن حقيقيان.
    return {
      llm: fakeProvider({
        scripts: [
          { match: /النطاق:/, reply: '{"category":"منتجات","city":null,"brandName":null}' },
          {
            match: /العدد المطلوب/,
            reply: JSON.stringify({ questions: [{ text: 'أفضل متجر؟', intent: 'discovery' }] }),
          },
        ],
        fallbackReply: '{"competitors":[]}',
      }),
      live: false,
    };
  }

  return { llm: withFallback([oxAlpha(openrouter), deepSeekFlash(deepseek)]), live: true };
}

function depsFor(domain: string, llm: LlmProvider, engines: EngineClient[]): PipelineDeps {
  const seen = { html: '', url: '' };

  return {
    async fetchPage(url: string): Promise<FetchResult> {
      const page = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 2_000_000 });
      if (seen.html === '') {
        seen.html = page.body;
        seen.url = page.finalUrl;
      }
      return page;
    },

    async fetchText(url: string): Promise<string | null> {
      try {
        const res = await safeFetch(url, { timeoutMs: 6_000, maxBytes: 500_000 });
        return res.status === 200 && res.body.length > 0 ? res.body : null;
      } catch {
        return null;
      }
    },

    async askEngine(engine: Engine, question: string, locale: string) {
      const client = engines.find((e) => e.engine === engine);
      // محرّك غير مُعدّ: نصرّح بذلك بدل اختراع إجابة — القاعدة 06.
      if (client === undefined) throw new Error(`engine ${engine} is not configured`);
      return client.ask(question, locale);
    },

    async collectSecurity(host: string): Promise<SecurityCollected> {
      return collectSecurity(host, seen.html, seen.url);
    },

    llm,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

// ── التشغيل ──────────────────────────────────────────────────

interface Row {
  domain: string;
  ok: boolean;
  error?: string;
  score: number;
  passed: number;
  total: number;
  findings: number;
  topSeverity: string;
  costMicros: number;
  warnings: string[];
  rules: RuleResult[];
}

function score(rules: readonly RuleResult[]): { pct: number; passed: number } {
  const sum = rules.reduce((a, r) => a + r.weight, 0);
  const got = rules.reduce((a, r) => a + (r.passed ? r.weight : 0), 0);
  return { pct: sum === 0 ? 0 : Math.round((got / sum) * 100), passed: rules.filter((r) => r.passed).length };
}

const { llm, live } = buildLlm();
const engines = buildEngines({
  openaiApiKey: process.env['OPENAI_API_KEY'] ?? null,
  perplexityApiKey: process.env['PERPLEXITY_API_KEY'] ?? null,
  dataforseoLogin: process.env['DATAFORSEO_LOGIN'] ?? null,
  dataforseoPassword: process.env['DATAFORSEO_PASSWORD'] ?? null,
});

console.log(`${domains.length} نطاقاً · محرّكات: ${engines.length === 0 ? 'لا شيء (جاهزية وأمن فقط)' : engines.map((e) => e.engine).join('، ')}`);
console.log(`سقف الإنفاق: $${MAX_USD.toFixed(2)}\n`);

const rows: Row[] = [];
const results: ScanResult[] = [];
let spentMicros = 0;

for (const [i, domain] of domains.entries()) {
  const n = String(i + 1).padStart(2, '0');

  if (spentMicros / 1e6 >= MAX_USD) {
    console.log(`${n}  ⏹  توقّفنا عند السقف — $${(spentMicros / 1e6).toFixed(4)}`);
    break;
  }

  process.stdout.write(`${n}  ${domain.padEnd(28)}`);

  try {
    // `full` لأنّ الجاهزية هي المقصودة، وهي معطّلة في `quick`.
    const { result, costMicros, warnings } = await runScan(
      { url: `https://${domain}`, kind: 'full' },
      depsFor(domain, llm, engines)
    );
    spentMicros += costMicros;
    results.push(result);

    const s = score(result.rules);
    const worst = ['critical', 'high', 'medium', 'low'].find((sev) =>
      result.security.some((f) => f.severity === sev)
    );

    rows.push({
      domain,
      ok: result.status === 'done',
      score: s.pct,
      passed: s.passed,
      total: result.rules.length,
      findings: result.security.length,
      topSeverity: worst ?? '—',
      costMicros,
      warnings,
      rules: [...result.rules],
    });

    console.log(`${String(s.pct).padStart(3)}%  ${s.passed}/${result.rules.length} قاعدة  ${result.security.length} إنذار${warnings.length > 0 ? `  ⚠ ${warnings.length}` : ''}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rows.push({
      domain, ok: false, error: message, score: 0, passed: 0, total: 0,
      findings: 0, topSeverity: '—', costMicros: 0, warnings: [], rules: [],
    });
    console.log(`✕  ${message.slice(0, 60)}`);
  }

  // لا نضغط على متاجر الناس.
  await new Promise((r) => setTimeout(r, 1200));
}

// ── التحليل ──────────────────────────────────────────────────

const audit: BatchAudit = auditRules(
  rows.filter((r) => r.ok).map((r) => ({ domain: r.domain, rules: r.rules }))
);

console.log('\n' + '─'.repeat(64));
console.log(`فُحص ${rows.filter((r) => r.ok).length} من ${rows.length} · التكلفة $${(spentMicros / 1e6).toFixed(4)}`);

if (audit.suspicious.length === 0) {
  console.log('\n✅ كل قاعدة فرّقت بين متجرين على الأقل.');
} else {
  console.log(`\n⚠️  ${audit.suspicious.length} قاعدة تستحق النظر:\n`);
  for (const r of audit.suspicious) {
    const why = r.flag === 'never_failed' ? 'نجحت على الكل — لم تفرّق' : 'أخفقت على الكل — مكسورة أو في الموضع الخطأ';
    console.log(`  وزن ${String(r.weight).padStart(2)}  ${r.key.padEnd(26)} ${r.passed}/${r.total}  ${why}`);
  }
}

// ── الحفظ ────────────────────────────────────────────────────

const stamp = new Date().toISOString().slice(0, 10);
mkdirSync('docs/review', { recursive: true });

writeFileSync(
  `docs/review/${stamp}.json`,
  JSON.stringify({ generatedAt: new Date().toISOString(), live, spentMicros, rows, audit, results }, null, 2) + '\n'
);

console.log(`\n→ docs/review/${stamp}.json`);
if (!live) console.log('ملاحظة: بلا مفاتيح — الجاهزية والأمن حقيقيان، وإجابات المحرّكات غائبة لا صفر.');
