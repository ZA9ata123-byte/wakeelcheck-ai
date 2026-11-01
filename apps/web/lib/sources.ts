/**
 * مصادر الإجابة — الصفحات التي اعتمد عليها المحرّك ليرشّح من رشّح.
 *
 * هي خطّة العمل لا التشخيص: متجرٌ غائب عن هذه الصفحات غائبٌ عن الإجابة.
 * والروابط كما عادت، مع نزع وسوم التتبّع (`utm_*`) التي يضيفها المحرّك —
 * لا تغيّر الصفحة، وتجعل الرابط يبدو إعلاناً.
 */

export interface AnswerSource {
  host: string;
  href: string;
}

export function answerSources(urls: readonly string[], limit = 6): AnswerSource[] {
  const out: AnswerSource[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (seen.has(host)) continue;
    seen.add(host);

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    out.push({ host, href: url.toString() });
    if (out.length >= limit) break;
  }
  return out;
}
