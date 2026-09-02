/**
 * ملفّ المنافس — نفحص من يسبقك بنفس القواعد التي فُحصتَ بها.
 *
 * ## لماذا هي دالة مستقلّة لا خطوةٌ في `runScan`
 *
 * كل منافس يعني `fetch` للرئيسية وثلاثة ملفات وصفحات منتجات — أي أن ثلاثة
 * منافسين يضاعفون زمن الفحص. وزمن المسار على Vercel لم يُقَس بعد (#9).
 * فحتى يُقاس، يبقى هذا مساراً يُستدعى حيث يُقرَّر — طلباً ثانياً أو عاملاً —
 * ولا يُدسّ داخل طلبٍ سقفُه مجهول. هذا هو تحفّظ codex المعماري في
 * CODEX-004، وهو صحيح.
 *
 * ## الكلفة
 *
 * صفرٌ من المحرّكات وصفرٌ من النماذج: `findProductUrls` دالة خالصة، ولا
 * نسأل هنا محرّكاً ولا نموذجاً. الكلفة الوحيدة زمنٌ وطلباتُ شبكة، وسقفُ
 * عددِ المنافسين هو ما يحدّها.
 *
 * ## ما لا نقوله
 *
 * لا ننسب سبقاً إلى قاعدة. نعرض **اختلافاً مرصوداً** ونقف — القاعدة 06
 * على السببية.
 */

import type { FetchResult, MatrixRow, RivalProfile, RivalReport, RivalSkipped, RuleResult } from '@wakeelcheck/core';
import {
  compareRules,
  parseRobots,
  runReadiness,
  PRODUCT_RULE_KEYS,
  type PageSnapshot,
} from '@wakeelcheck/readiness';
import { findProductUrls, selectRivals, DEFAULT_RIVAL_CAP } from '@wakeelcheck/visibility';

export interface RivalDeps {
  fetchPage(url: string): Promise<FetchResult>;
  /** يُرجع null حين لا يوجد الملف. */
  fetchText(url: string): Promise<string | null>;
}

export interface RivalOptions {
  /** كم منافساً نفحص. الافتراضي ثلاثة. */
  cap?: number;
  /** كم صفحة منتج نزور عند كل منافس. */
  productPages?: number;
}

function toSnapshot(fetched: FetchResult): PageSnapshot {
  return {
    url: fetched.finalUrl,
    status: fetched.status,
    headers: fetched.headers,
    html: fetched.body,
  };
}

/**
 * يفحص المنافسين المختارين ويقابلهم بالمتجر.
 *
 * منافسٌ لم يُجب يُسجَّل `unreachable` ولا يُسقط البقيّة — نفس مبدأ خطّ
 * الأنابيب: فشل جزء لا يُسقط الكل.
 *
 * وحين لا نجد عنده صفحة منتج، نُسقط قواعد المنتج من المقارنة كلّها. عنده
 * قد يكون مخطّط روابطه مختلفاً لا موقعه ناقصاً، وعدّ ذلك سبقاً لنا يخترع
 * تفوّقاً لم نقسه.
 */
export async function profileRivals(
  matrix: readonly MatrixRow[],
  storeRules: readonly RuleResult[],
  storeScore: number,
  deps: RivalDeps,
  opts: RivalOptions = {}
): Promise<RivalReport> {
  const { picked, skipped, cap } = selectRivals(matrix, opts.cap ?? DEFAULT_RIVAL_CAP);
  const productLimit = opts.productPages ?? 3;

  const profiled: RivalProfile[] = [];
  const missed: RivalSkipped[] = [...skipped];

  for (const rival of picked) {
    const base = `https://${rival.domain}`;

    let home: FetchResult;
    try {
      home = await deps.fetchPage(base);
    } catch {
      missed.push({ name: rival.name, domain: rival.domain, reason: 'unreachable' });
      continue;
    }

    const [robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
      deps.fetchText(`${base}/robots.txt`).catch(() => null),
      deps.fetchText(`${base}/llms.txt`).catch(() => null),
      deps.fetchText(`${base}/sitemap.xml`).catch(() => null),
    ]);

    const products: PageSnapshot[] = [];
    for (const url of findProductUrls(home.body, home.finalUrl, sitemapXml, productLimit)) {
      try {
        products.push(toSnapshot(await deps.fetchPage(url)));
      } catch {
        // صفحة منتج واحدة تعذّرت لا تُسقط المنافس كلّه.
      }
    }

    const report = runReadiness({
      domain: rival.domain,
      home: toSnapshot(home),
      products,
      robots: parseRobots(robotsTxt),
      llmsTxt,
      sitemapFound: sitemapXml !== null,
    });

    // بلا صفحة منتج لا تُقاس قواعد المنتج عنده — فتخرج من المقارنة كلّها.
    const comparable =
      products.length > 0
        ? report.results
        : report.results.filter((r) => !PRODUCT_RULE_KEYS.has(r.key));

    const { ahead, behind } = compareRules(storeRules, comparable);

    profiled.push({
      name: rival.name,
      domain: rival.domain,
      present: rival.present,
      measured: rival.measured,
      score: report.score,
      ahead,
      behind,
    });
  }

  return { profiled, skipped: missed, cap, storeScore };
}
