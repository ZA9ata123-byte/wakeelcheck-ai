#!/usr/bin/env node
/**
 * يبني ملفات PDF من مصادر HTML في docs/html عبر Chromium بلا رأس.
 *
 *   node scripts/build-docs.cjs
 *   CHROME_PATH=/usr/bin/chromium node scripts/build-docs.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTML_DIR = path.join(ROOT, 'docs', 'html');
const OUT_DIR = path.join(ROOT, 'docs');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

// النموذج التفاعلي يفقد معناه كملف PDF — يبقى HTML فقط.
const SKIP = new Set(['05-landing-prototype.html']);

const PRINT_CSS = `
@page { size: A4; margin: 14mm 12mm 16mm; }
html, body { background: #ffffff !important; }
*, *::before, *::after {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  animation: none !important;
  transition: none !important;
}
.animark { background-size: 100% 100% !important; }
.wrap { max-width: none !important; padding-inline: 0 !important; padding-block: 0 !important; }
section, .pkg, .svc, .phase, .tcard, .card, .tile, .figure, .exhibit,
.alarm, .sw, .fstep, .thesis, .star, .funnel, .device, .demo, .spec,
.rule-box, .never, .stop, .ask, .gate, .steps, .answer, .pricebox { break-inside: avoid; }
pre { break-inside: avoid; white-space: pre-wrap !important; word-break: break-word; overflow: visible !important; }
.tbl { overflow: visible !important; }
table { min-width: 0 !important; break-inside: auto; }
tr, th, td { break-inside: avoid; }
h1, h2, h3, h4 { break-after: avoid; }
.head, .sec-head, .top, .masthead, .pkg-top, .svc-top { break-after: avoid; }
.scroll-x { overflow: visible !important; }
.figure svg { min-width: 0 !important; }
a { text-decoration: none; }
`;

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'لم يُعثر على Chromium. مرّر المسار عبر CHROME_PATH=/path/to/chrome'
  );
}

/** يفرض الوضع الفاتح ويحقن أنماط الطباعة قبل </body>. */
function prepareForPrint(html) {
  const withTheme = html.replace(/<html([^>]*)>/i, (match, attrs) =>
    /data-theme=/i.test(attrs)
      ? match.replace(/data-theme="[^"]*"/i, 'data-theme="light"')
      : `<html${attrs} data-theme="light">`
  );
  const styleTag = `<style>${PRINT_CSS}</style>`;
  return withTheme.includes('</body>')
    ? withTheme.replace('</body>', `${styleTag}\n</body>`)
    : withTheme + styleTag;
}

function main() {
  const chrome = findChrome();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-docs-'));

  const sources = fs
    .readdirSync(HTML_DIR)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f))
    .sort();

  if (sources.length === 0) {
    console.error(`لا توجد مصادر HTML في ${HTML_DIR}`);
    process.exit(1);
  }

  for (const file of sources) {
    const slug = path.basename(file, '.html');
    const tmpFile = path.join(tmpDir, file);
    const pdfPath = path.join(OUT_DIR, `${slug}.pdf`);

    fs.writeFileSync(
      tmpFile,
      prepareForPrint(fs.readFileSync(path.join(HTML_DIR, file), 'utf8'))
    );

    execFileSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--virtual-time-budget=20000', // ينتظر تحميل خطوط Google
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${tmpFile}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 }
    );

    const kb = (fs.statSync(pdfPath).size / 1024).toFixed(0);
    console.log(`✅ docs/${slug}.pdf — ${kb} KB`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nتم بناء ${sources.length} ملفات PDF.`);
}

main();
