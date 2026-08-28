/**
 * يحوّل نموذج التقرير إلى صفحة.
 *
 *   npx tsx scripts/render-specimen.ts
 *
 * يقرأ docs/specimen/report.json — وهو مخرَج خطّ الأنابيب الحقيقي — ويرسمه
 * برموز نظام العلامة نفسها. لا يحسب شيئاً ولا يعيد ترتيب شيء: كل رقم في
 * الصفحة موجود في الـJSON، وكل نص إجابة منسوخ حرفياً.
 *
 * الغرض منه أن يكون المرجع الذي يصمّم عليه المصمم ويبني عليه المبرمج:
 * شاشة واحدة فيها كل قسم بحالته الحقيقية.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { ScanResult, SecurityFinding, RuleResult, EngineAnswer } from '../packages/core/src/index.ts';

interface Specimen {
  generatedAt: string;
  note: string;
  costMicros: number;
  warnings: string[];
  result: ScanResult;
}

const spec = JSON.parse(readFileSync('docs/specimen/report.json', 'utf8')) as Specimen;
const r = spec.result;

// ── أدوات ────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * يضع العلامة على أسماء المنافسين داخل نص الإجابة.
 *
 * الأطول أولاً حتى لا يبتلع اسم قصير جزءاً من اسم أطول — نفس ترتيب
 * markCompetitors في الواجهة. ولا يُعلَّم إلا اسم عاد من الاستخراج، وهو
 * أصلاً اسم تحقّق خطّ الأنابيب من وجوده حرفياً في النص.
 */
function mark(text: string, names: string[]): string {
  if (names.length === 0) return esc(text);

  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const pattern = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  return text
    .split(new RegExp(`(${pattern})`, 'g'))
    .map((part) => (sorted.includes(part) ? `<mark class="rival">${esc(part)}</mark>` : esc(part)))
    .join('');
}

const SEV_AR: Record<string, string> = {
  critical: 'حرج',
  high: 'عالٍ',
  medium: 'متوسط',
  low: 'منخفض',
};

const ENGINE_AR: Record<string, string> = {
  chatgpt: 'ChatGPT',
  ai_overviews: 'Google AI Overviews',
  ai_mode: 'Google AI Mode',
  perplexity: 'Perplexity',
};

// ── الحساب المعروض ───────────────────────────────────────────

const wSum = r.rules.reduce((a, x) => a + x.weight, 0);
const wGot = r.rules.reduce((a, x) => a + (x.passed ? x.weight : 0), 0);
const score = wSum === 0 ? 0 : Math.round((wGot / wSum) * 100);
const passed = r.rules.filter((x) => x.passed).length;

const headline = [...r.security].sort((a, b) => {
  const order = ['critical', 'high', 'medium', 'low'];
  return order.indexOf(a.severity) - order.indexOf(b.severity);
})[0];

const sov = r.shareOfVoice;

// ── الأجزاء ──────────────────────────────────────────────────

function answerCard(a: EngineAnswer): string {
  const q = r.questions.find((x) => x.id === a.questionId);
  const names = a.competitors.map((c) => c.name);

  return `
    <article class="sheet answer-sheet">
      <div class="sheet-hd">
        <span class="who lt">${esc(ENGINE_AR[a.engine] ?? a.engine)}</span>
        <span class="q">${esc(q?.text ?? '—')}</span>
        <span class="when lt">${esc(a.capturedAt.slice(0, 16).replace('T', ' '))}</span>
      </div>

      <p class="answer">${mark(a.answerText, names)}</p>

      <div class="verdict">
        <div class="vt" data-tone="${a.storeMentioned ? 'good' : 'bad'}">
          <span class="lab">متجرك <span class="lt">${esc(r.profile?.domain ?? '')}</span></span>
          <span class="val lt">${a.storeMentioned ? '1 / 1' : '0 / 1'}</span>
          <span class="sub">${a.storeMentioned ? 'مذكور' : 'غير مذكور'}</span>
        </div>
        <div class="vt">
          <span class="lab">من ذُكر بدلاً منك</span>
          <span class="val names">${names.length === 0 ? '—' : esc(names.join('، '))}</span>
          <span class="sub">${names.length} اسم في هذه الإجابة</span>
        </div>
      </div>
    </article>`;
}

function ruleRow(x: RuleResult): string {
  return `
    <tr>
      <td class="st">${x.passed ? '<span class="chip" data-s="pass">ناجح</span>' : '<span class="chip" data-s="fail">راسب</span>'}</td>
      <td class="key lt">${esc(x.key)}</td>
      <td class="det">${esc(x.detail.ar)}</td>
      <td class="ev lt">${esc(x.evidence)}</td>
      <td class="num">${x.weight}</td>
    </tr>`;
}

function findingRow(f: SecurityFinding): string {
  return `
    <div class="finding" data-sev="${f.severity}">
      <div class="f-hd">
        <span class="sev">${esc(SEV_AR[f.severity] ?? f.severity)}</span>
        <h4>${esc(f.title.ar)}</h4>
        <span class="kind lt">${esc(f.kind)}</span>
      </div>
      <p class="f-d">${esc(f.detail.ar)}</p>
      <p class="f-e lt">${esc(f.evidence)}</p>
    </div>`;
}

const fixes = r.rules.filter((x) => !x.passed && typeof x.fixSnippet === 'string' && x.fixSnippet.length > 0);

// ── الصفحة ───────────────────────────────────────────────────

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>نموذج تقرير وكيل تشيك</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@200;300;400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
:root{--ground:#e9e8e4;--sheet:#fff;--sheet-2:#f4f3f0;--rule:#d5d3cc;--rule-soft:#e2e0da;--ink:#171412;--ink-2:#3b3733;--muted:#6d6862;--faint:#9a948c;--rival:#d8452c;--rival-mark:#fbe3dd;--rival-deep:#a8321f;--present:#1a6f52;--present-mark:#dcefe6;--caution:#9a6a10;--caution-mark:#f7ecd6;--lift:0 1px 2px rgb(23 20 18/5%),0 10px 28px -16px rgb(23 20 18/28%);--face:'Readex Pro','Segoe UI',Tahoma,sans-serif;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme='light']){--ground:#12100f;--sheet:#1b1917;--sheet-2:#232120;--rule:#35322f;--rule-soft:#2a2825;--ink:#f1efec;--ink-2:#cfcbc6;--muted:#9b958e;--faint:#726c65;--rival:#ff7259;--rival-mark:#38190f;--rival-deep:#ff9581;--present:#4fbc91;--present-mark:#10281f;--caution:#d59f3c;--caution-mark:#2e2312;--lift:0 1px 2px rgb(0 0 0/50%),0 10px 28px -16px rgb(0 0 0/90%)}}
:root[data-theme='dark']{--ground:#12100f;--sheet:#1b1917;--sheet-2:#232120;--rule:#35322f;--rule-soft:#2a2825;--ink:#f1efec;--ink-2:#cfcbc6;--muted:#9b958e;--faint:#726c65;--rival:#ff7259;--rival-mark:#38190f;--rival-deep:#ff9581;--present:#4fbc91;--present-mark:#10281f;--caution:#d59f3c;--caution-mark:#2e2312;--lift:0 1px 2px rgb(0 0 0/50%),0 10px 28px -16px rgb(0 0 0/90%)}

*,*::before,*::after{box-sizing:border-box}
body{margin:0;direction:rtl;background:var(--ground);color:var(--ink);font-family:var(--face);font-weight:300;font-size:15.5px;line-height:1.72;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;line-height:1.22;font-weight:600;letter-spacing:-0.02em;text-wrap:balance}
p{margin:0}
.lt{font-family:var(--mono);direction:ltr;unicode-bidi:isolate}
.page{max-width:58rem;margin-inline:auto;padding-inline:clamp(1.1rem,4vw,2.5rem);padding-block:clamp(2rem,5vw,3.5rem) 4rem}

.banner{background:var(--caution-mark);border:1px solid var(--caution);border-radius:4px;padding:0.9rem 1.15rem;margin-block-end:2.25rem;font-size:0.87rem;color:var(--ink-2)}
.banner b{color:var(--caution);font-weight:600}

.top{padding-block-end:1.75rem;border-block-end:1px solid var(--rule)}
.top .kicker{font-family:var(--mono);font-size:0.66rem;letter-spacing:0.24em;color:var(--faint);margin-block-end:1.5rem}
.top h1{font-size:clamp(1.7rem,4.4vw,2.6rem);font-weight:200;letter-spacing:-0.035em;margin-block-end:0.65rem}
.top h1 .dom{font-weight:500}
.top .meta{font-family:var(--mono);font-size:0.72rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:0.4rem 1.4rem}

.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:4px;overflow:hidden;margin-block-start:1.75rem}
.tile{background:var(--sheet);padding:0.95rem 1.05rem 1.1rem;display:flex;flex-direction:column;gap:0.1rem}
.tile .k{font-family:var(--mono);font-size:0.6rem;letter-spacing:0.13em;color:var(--faint);text-transform:uppercase}
.tile .v{font-family:var(--mono);font-size:1.6rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.32}
.tile .n{font-size:0.76rem;color:var(--muted);line-height:1.5}
.tile[data-tone='bad'] .v{color:var(--rival)}
.tile[data-tone='good'] .v{color:var(--present)}
.tile[data-tone='warn'] .v{color:var(--caution)}

section{padding-block:clamp(2rem,4.5vw,3rem);border-block-end:1px solid var(--rule)}
section:last-of-type{border-block-end:none}
.eyebrow{font-family:var(--mono);font-size:0.63rem;letter-spacing:0.2em;color:var(--faint);text-transform:uppercase;margin-block-end:0.8rem}
section>h2{font-size:clamp(1.3rem,2.8vw,1.7rem);margin-block-end:0.7rem}
section>.lede{color:var(--ink-2);max-width:56ch;margin-block-end:1.6rem}

.sheet{background:var(--sheet);border:1px solid var(--rule);border-radius:4px;box-shadow:var(--lift)}
.answer-sheet{margin-block-end:1.15rem}
.sheet-hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.7rem;padding:0.8rem 1.2rem;border-block-end:1px solid var(--rule);background:var(--sheet-2);border-radius:4px 4px 0 0;font-family:var(--mono);font-size:0.67rem;letter-spacing:0.08em;color:var(--muted)}
.sheet-hd .who{color:var(--ink);font-weight:700}
.sheet-hd .q{font-family:var(--face);letter-spacing:0;font-size:0.83rem}
.sheet-hd .when{margin-inline-start:auto;color:var(--faint)}

.answer{padding:1.4rem 1.2rem;font-size:1.02rem;line-height:2.05}
mark.rival{background-image:linear-gradient(var(--rival-mark),var(--rival-mark));background-repeat:no-repeat;background-position:right center;background-size:100% 100%;color:var(--rival-deep);font-weight:500;padding:0.06em 0.38em;border-radius:3px;border-block-end:2px solid var(--rival)}

.verdict{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:1px;background:var(--rule);border-block-start:1px solid var(--rule)}
.vt{background:var(--sheet);padding:0.85rem 1.2rem;display:flex;flex-direction:column;gap:0.12rem}
.vt .lab{font-family:var(--mono);font-size:0.61rem;letter-spacing:0.13em;color:var(--faint);text-transform:uppercase}
.vt .val{font-family:var(--mono);font-size:1.45rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.35}
.vt .val.names{font-family:var(--face);font-size:0.98rem;font-weight:500;color:var(--rival-deep);line-height:1.6}
.vt[data-tone='bad'] .val{color:var(--rival)}
.vt[data-tone='good'] .val{color:var(--present)}
.vt .sub{font-size:0.79rem;color:var(--muted)}

.finding{background:var(--sheet);border:1px solid var(--rule);border-inline-start-width:4px;border-radius:4px;padding:1rem 1.15rem;margin-block-end:0.7rem;display:flex;flex-direction:column;gap:0.4rem}
.finding[data-sev='critical']{border-inline-start-color:var(--rival)}
.finding[data-sev='high']{border-inline-start-color:var(--rival)}
.finding[data-sev='medium']{border-inline-start-color:var(--caution)}
.finding[data-sev='low']{border-inline-start-color:var(--rule)}
.f-hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.65rem}
.f-hd h4{font-size:1rem;font-weight:500}
.f-hd .sev{font-family:var(--mono);font-size:0.6rem;letter-spacing:0.12em;padding:0.16rem 0.5rem;border-radius:3px}
.finding[data-sev='critical'] .sev,.finding[data-sev='high'] .sev{background:var(--rival-mark);color:var(--rival-deep)}
.finding[data-sev='medium'] .sev{background:var(--caution-mark);color:var(--caution)}
.finding[data-sev='low'] .sev{background:var(--sheet-2);color:var(--muted)}
.f-hd .kind{margin-inline-start:auto;font-size:0.64rem;color:var(--faint)}
.f-d{font-size:0.9rem;color:var(--ink-2)}
.f-e{font-size:0.72rem;color:var(--muted);background:var(--sheet-2);border:1px solid var(--rule);border-radius:3px;padding:0.4rem 0.6rem;overflow-x:auto;white-space:pre}

.scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:4px;background:var(--sheet)}
table{width:100%;border-collapse:collapse;font-size:0.85rem;min-width:44rem}
th{text-align:right;font-family:var(--mono);font-size:0.59rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--faint);font-weight:500;padding:0.65rem 0.9rem;background:var(--sheet-2);border-block-end:1px solid var(--rule);white-space:nowrap}
td{padding:0.6rem 0.9rem;border-block-end:1px solid var(--rule-soft);vertical-align:top;color:var(--ink-2)}
tr:last-child td{border-block-end:none}
td.st{white-space:nowrap}
td.key{font-size:0.75rem;color:var(--ink);white-space:nowrap}
td.ev{font-size:0.71rem;color:var(--muted);max-width:18rem}
td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:left;direction:ltr;unicode-bidi:isolate}
.chip{display:inline-block;font-family:var(--mono);font-size:0.59rem;letter-spacing:0.09em;padding:0.16rem 0.5rem;border-radius:3px;font-weight:500;white-space:nowrap}
.chip[data-s='pass']{background:var(--present-mark);color:var(--present)}
.chip[data-s='fail']{background:var(--rival-mark);color:var(--rival-deep)}

.fix{background:var(--sheet);border:1px solid var(--rule);border-radius:4px;margin-block-end:0.7rem;overflow:hidden}
.fix .fh{padding:0.7rem 1.1rem;background:var(--sheet-2);border-block-end:1px solid var(--rule);font-size:0.88rem;display:flex;flex-wrap:wrap;gap:0.6rem;align-items:baseline}
.fix .fh .lt{font-size:0.7rem;color:var(--faint)}
.fix pre{margin:0;padding:0.95rem 1.1rem;font-family:var(--mono);font-size:0.73rem;line-height:1.75;direction:ltr;unicode-bidi:isolate;overflow-x:auto;color:var(--ink-2)}

.foot{margin-block-start:2.5rem;padding-block-start:1.4rem;border-block-start:1px solid var(--rule);font-family:var(--mono);font-size:0.65rem;letter-spacing:0.07em;color:var(--faint);display:flex;flex-wrap:wrap;gap:0.4rem 1.3rem}

@media print{.finding,.fix,.answer-sheet,.tile{break-inside:avoid}}
</style>
</head>
<body>
<div class="page">

<div class="banner">
  <b>نموذج.</b> المدخل ثابت (متجر مُختلق). القواعد والشدّات وحصة الصوت
  <b>محسوبة بخطّ الأنابيب الحقيقي</b> — نفس الكود الذي سيعمل في الإنتاج. نصوص
  إجابات المحرّكات وحدها ثابتة، لأنها تحتاج مفتاحاً. تولّد بـ
  <span class="lt">scripts/make-specimen.ts</span>.
</div>

<header class="top">
  <div class="kicker">وكيل تشيك · تقرير الظهور أمام وكلاء الذكاء الاصطناعي</div>
  <h1>كيف يظهر <span class="dom lt">${esc(r.profile?.domain ?? '')}</span> أمام وكلاء الذكاء الاصطناعي</h1>
  <div class="meta">
    <span>${esc(r.profile?.category ?? '')}${r.profile?.city ? ' · ' + esc(r.profile.city) : ''}</span>
    <span class="lt">${esc(r.profile?.platform ?? '')}</span>
    <span class="lt">${esc(spec.generatedAt.slice(0, 16).replace('T', ' '))}</span>
    <span class="lt">scan ${esc(r.id)}</span>
  </div>

  <div class="tiles">
    <div class="tile" data-tone="bad">
      <span class="k">حصّتك من الصوت</span>
      <span class="v">${sov.total === 0 ? '—' : Math.round((sov.store / sov.total) * 100) + '%'}</span>
      <span class="n">${sov.store} من ${sov.total} إجابة</span>
    </div>
    <div class="tile" data-tone="${score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad'}">
      <span class="k">جاهزية الوكلاء</span>
      <span class="v">${score}%</span>
      <span class="n">${passed} من ${r.rules.length} قاعدة</span>
    </div>
    <div class="tile" data-tone="bad">
      <span class="k">أعلى منافس</span>
      <span class="v" style="font-size:1.05rem">${sov.top === null ? '—' : esc(sov.top.name)}</span>
      <span class="n">الأكثر ذكراً بدلاً منك</span>
    </div>
    <div class="tile" data-tone="bad">
      <span class="k">إنذارات أمنية</span>
      <span class="v">${r.security.length}</span>
      <span class="n">${esc(SEV_AR[headline?.severity ?? ''] ?? '')} أعلاها</span>
    </div>
  </div>
</header>

<section>
  <div class="eyebrow">01 · الدليل</div>
  <h2>ما قاله المحرّك حرفياً</h2>
  <p class="lede">
    النص كما ورد، بلا تنظيف ولا اقتصاص — هو الدليل، وتعديله يُبطله. الأسماء
    المعلَّمة تحقّق البرنامج من ورودها حرفياً في النص قبل وضع العلامة.
  </p>
  ${r.answers.slice(0, 4).map(answerCard).join('')}
  ${r.answers.length > 4 ? `<p class="lede" style="margin:0">وبقية الإجابات — ${r.answers.length - 4} إجابة أخرى في التقرير الكامل.</p>` : ''}
</section>

<section>
  <div class="eyebrow">02 · الأمن</div>
  <h2>${r.security.length} إنذار — كلها من مصادر عامة</h2>
  <p class="lede">
    فحص سلبي بالكامل: RDAP وTLS وDNS وملفات JS التي يحمّلها كل زائر. لا محاولة
    دخول ولا اختبار اختراق. قيمة أي سرّ تُطمَس عند المصدر ولا تدخل التقرير كاملة.
  </p>
  ${r.security.map(findingRow).join('')}
</section>

<section>
  <div class="eyebrow">03 · الجاهزية</div>
  <h2>${passed} من ${r.rules.length} قاعدة ناجحة — ${score}%</h2>
  <p class="lede">
    النتيجة موزونة: <span class="lt">Σ(الوزن × نجح) ÷ Σالوزن</span>. الدليل في
    العمود الأخير هو ما قِيس فعلاً، لا وصف له.
  </p>
  <div class="scroll">
    <table>
      <thead><tr><th>الحالة</th><th>القاعدة</th><th>التفصيل</th><th>الدليل</th><th>الوزن</th></tr></thead>
      <tbody>${r.rules.map(ruleRow).join('')}</tbody>
    </table>
  </div>
</section>

${
  fixes.length === 0
    ? ''
    : `<section>
  <div class="eyebrow">04 · الإصلاح</div>
  <h2>كود جاهز للصق</h2>
  <p class="lede">
    كل قاعدة راسبة لها إصلاح حقيقي تُرفَق به. قاعدة بلا إصلاح تُنتج ضجيجاً في
    التقرير ولا تُنتج قيمة للتاجر.
  </p>
  ${fixes
    .map(
      (x) => `<div class="fix">
    <div class="fh"><span>${esc(x.detail.ar)}</span><span class="lt">${esc(x.key)}</span></div>
    <pre>${esc(x.fixSnippet ?? '')}</pre>
  </div>`
    )
    .join('')}
</section>`
}

<footer class="foot">
  <span>مولّد من <span class="lt">docs/specimen/report.json</span></span>
  <span>التكلفة <span class="lt">$${(spec.costMicros / 1e6).toFixed(4)}</span></span>
  <span>القواعد <span class="lt">packages/readiness</span></span>
  <span>الأمن <span class="lt">packages/security</span></span>
</footer>

</div>
</body>
</html>
`;

writeFileSync('docs/specimen/report.html', html);
console.log(`→ docs/specimen/report.html  (${Math.round(html.length / 1024)} KB)`);
console.log(`   ${r.answers.length} إجابة · ${r.security.length} إنذار · ${r.rules.length} قاعدة · ${fixes.length} إصلاح`);
