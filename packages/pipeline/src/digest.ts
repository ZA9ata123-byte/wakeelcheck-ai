/**
 * النشرة الأسبوعية — ما يقرؤه التاجر من `diffScans`.
 *
 * هذه الجملة هي ما يُشترى شهرياً، فكلّ كلمةٍ فيها ادّعاء:
 *
 * - **«اختفيتَ من ChatGPT»** لا تُقال إلا عن سؤالٍ سُئل في الأسبوعين.
 *   `diffScans` تضمن ذلك؛ والنشرة لا تضيف إليه.
 * - **«لا تغيّر»** ادّعاءٌ كذلك — ادّعاء استقرار. فلا تُقال إلا إن قورن شيء.
 *   أسبوعٌ لم يُقارَن فيه سؤال يقول ذلك صراحةً، ولا يتظاهر بالهدوء.
 * - **ما لم يُقَس يُذكر.** محرّكٌ سقط هذا الأسبوع سطرٌ في النشرة، لا صمت —
 *   وإلّا قرأ التاجر غياب الخبر خبراً.
 *
 * والترتيب ترتيب الأهمية: ما يحتاج تدخّلاً أولاً.
 */

import type { Bilingual, Digest, DigestTone, Engine } from '@wakeelcheck/core';
import type { ScanDiff } from './diff.ts';

const ENGINE: Record<Engine, string> = {
  chatgpt: 'ChatGPT',
  ai_overviews: 'Google AI Overviews',
  ai_mode: 'Google AI Mode',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
};

/**
 * العدد ومعدوده بالعربية: واحد، اثنان، من ثلاثة إلى عشرة جمعاً، وما فوقها
 * مفرداً منصوباً. «قارنّا 1 سؤالاً» ركيكة يقرؤها التاجر فيشكّ في الباقي.
 */
export function countAr(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

const QUESTIONS_AR = { one: 'سؤالاً واحداً', two: 'سؤالين', few: 'أسئلة', many: 'سؤالاً' };
const ENGINES_AR = { one: 'محرّكٍ واحد', two: 'محرّكين', few: 'محرّكات', many: 'محرّكاً' };

const list = (names: readonly string[], and: string): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join('، ')} ${and} ${names[names.length - 1]}`;

const listEn = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function weeklyDigest(diff: ScanDiff, domain: string): Digest {
  const lost = diff.engines.filter((e) => e.direction === 'lost').map((e) => ENGINE[e.engine]);
  const gained = diff.engines.filter((e) => e.direction === 'gained').map((e) => ENGINE[e.engine]);
  // ما قِيس الأسبوع الماضي ولم يُقَس هذا الأسبوع — يُذكر ولا يُفسَّر.
  const dark = diff.engines
    .filter((e) => e.before !== 'not_measured' && e.after === 'not_measured')
    .map((e) => ENGINE[e.engine]);

  const appeared = diff.competitors.filter((c) => c.change === 'appeared');
  const vanished = diff.competitors.filter((c) => c.change === 'disappeared');
  const regressed = diff.rules.filter((r) => r.change === 'regressed');
  const fixed = diff.rules.filter((r) => r.change === 'fixed');

  const lines: Bilingual[] = [];

  if (lost.length > 0) {
    lines.push({
      ar: `اختفيتَ من إجابات ${list(lost, 'و')}.`,
      en: `You dropped out of ${listEn(lost)}'s answers.`,
    });
  }
  for (const c of appeared) {
    lines.push({
      ar: `ظهر «${c.name}» في إجابات ${countAr(c.after, ENGINES_AR)} لم يكن فيها.`,
      en: `“${c.name}” now appears in ${c.after === 1 ? 'one engine' : `${c.after} engines`} it was absent from.`,
    });
  }
  for (const r of regressed) {
    lines.push({ ar: `انكسر: ${r.detail.ar}`, en: `Broke: ${r.detail.en}` });
  }
  if (gained.length > 0) {
    lines.push({
      ar: `ظهرتَ في إجابات ${list(gained, 'و')}.`,
      en: `You now appear in ${listEn(gained)}'s answers.`,
    });
  }
  for (const r of fixed) {
    lines.push({ ar: `أُصلح: ${r.detail.ar}`, en: `Fixed: ${r.detail.en}` });
  }
  for (const c of vanished) {
    lines.push({ ar: `غاب «${c.name}» عن الإجابات.`, en: `“${c.name}” is gone from the answers.` });
  }
  if (diff.scoreAfter !== diff.scoreBefore && (regressed.length > 0 || fixed.length > 0)) {
    lines.push({
      ar: `جاهزيّة متجرك: ${diff.scoreBefore}% ← ${diff.scoreAfter}%.`,
      en: `Store readiness: ${diff.scoreBefore}% → ${diff.scoreAfter}%.`,
    });
  }
  if (dark.length > 0) {
    lines.push({
      ar: `لم يُقَس هذا الأسبوع: ${list(dark, 'و')} — عطلٌ عندنا لا غيابٌ عندك.`,
      en: `Not measured this week: ${listEn(dark)} — an outage on our side, not an absence on yours.`,
    });
  }

  const bad = lost.length + appeared.length + regressed.length;
  const good = gained.length + fixed.length + vanished.length;

  const tone: DigestTone =
    bad > 0 ? 'alert' : good > 0 ? 'good' : diff.comparedQuestions > 0 ? 'quiet' : 'incomparable';

  const headline: Bilingual =
    tone === 'alert'
      ? lost.length > 0
        ? { ar: `${domain} اختفى من ${list(lost, 'و')} هذا الأسبوع`, en: `${domain} dropped out of ${listEn(lost)} this week` }
        : { ar: `تغيّرٌ يستحقّ نظرك في ${domain}`, en: `A change at ${domain} worth your attention` }
      : tone === 'good'
        ? { ar: `أخبارٌ طيّبة عن ${domain} هذا الأسبوع`, en: `Good news for ${domain} this week` }
        : tone === 'quiet'
          ? { ar: `لا تغيّر في ${domain} هذا الأسبوع`, en: `No change at ${domain} this week` }
          : { ar: `لم نستطع مقارنة ${domain} هذا الأسبوع`, en: `We could not compare ${domain} this week` };

  const engines = diff.comparableEngines.length;
  const basis: Bilingual =
    diff.comparedQuestions === 0
      ? {
          ar: 'لم يُسأل سؤالٌ مشترك في الأسبوعين، فلم يُقارَن ظهورك. جاهزية الموقع وحدها قورنت.',
          en: 'No question was asked in both weeks, so your visibility was not compared. Only site readiness was.',
        }
      : {
          ar: `قارنّا ${countAr(diff.comparedQuestions, QUESTIONS_AR)} على ${countAr(engines, ENGINES_AR)} — السؤال نفسه في الأسبوعين.`,
          en: `We compared ${diff.comparedQuestions} question${diff.comparedQuestions === 1 ? '' : 's'} across ${engines} engine${engines === 1 ? '' : 's'} — the same question both weeks.`,
        };

  return { tone, headline, lines, basis };
}

/**
 * نشرة أوّل قياس: لا ماضيَ يُقارَن به.
 *
 * لا يُقال فيها «لا تغيّر» ولا «اختفيت» — لم يكن قبلها شيء. تقول ما سيحدث.
 */
export function baselineDigest(domain: string, questions: number): Digest {
  return {
    tone: 'baseline',
    headline: {
      ar: `بدأنا متابعة ${domain}`,
      en: `We have started monitoring ${domain}`,
    },
    lines: [],
    basis: {
      ar: `هذا أوّل قياس. نعيد ${countAr(questions, QUESTIONS_AR)} نفسها كلّ أسبوع، ونخبرك بما تغيّر.`,
      en: `This is the first measurement. We will ask the same ${questions} question${questions === 1 ? '' : 's'} every week and tell you what changed.`,
    },
  };
}
