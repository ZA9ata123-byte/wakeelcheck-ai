import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS } from '../src/pipeline.ts';

/**
 * محرّكٌ مبنيّ ليس محرّكاً مُشغَّلاً.
 *
 * `buildEngines` تُرجع كل ما تكفيه بياناتُ اعتماده، و`PLANS` وحدها تقرّر من
 * يُسأل. الفرق بينهما هو ما يمنع محرّكاً غير مثبَّت من أن يبدأ فجأةً في
 * الكلفة والزمن لمجرّد أن مفتاحاً وُجد في البيئة.
 *
 * لهذا يُثبَّت هنا ما تسأله كل خطّة حرفياً: إضافة محرّك إلى خطّة قرارٌ
 * يُتّخذ، لا أثرٌ جانبيّ لتوسيع نوع.
 */

test('الخطط تعدّد محرّكاتها حرفياً', () => {
  assert.deepEqual(PLANS.quick.engines, ['chatgpt', 'ai_mode']);
  assert.deepEqual(PLANS.full.engines, ['chatgpt', 'ai_overviews', 'ai_mode', 'perplexity']);
  assert.deepEqual(PLANS.monitor.engines, ['chatgpt', 'ai_overviews', 'ai_mode', 'perplexity']);
});

test('copilot مبنيّ وغير مُشغَّل — مساره لم يُثبَّت بردٍّ حيّ', () => {
  // القاعدة 06: لا يُعرض «Copilot» لتاجر قبل نداء حقيقي واحد يُثبت السطح.
  for (const [kind, plan] of Object.entries(PLANS)) {
    assert.ok(!plan.engines.includes('copilot'), `${kind} أدرجت محرّكاً غير مثبَّت`);
  }
});

test('المجاني: ChatGPT وGoogle AI Mode وحدهما — سقف الكلفة قبل أي ترويج', () => {
  // القاعدة 04: حملة واحدة بلا حدّ تحرق الميزانية.
  // تغيير سلوك بقرار المالك: AI Mode أرخص من ChatGPT باثنتي عشرة مرّة
  // (0.004$ على DataForSEO، ومجّاني في خطة SerpApi)، و«ChatGPT + Google»
  // في الفحص المجانيّ ما لا تقدّمه أداةٌ عربية. الكامل وحده يسأل الأربعة.
  assert.deepEqual(PLANS.quick.engines, ['chatgpt', 'ai_mode']);
  assert.ok(PLANS.quick.questions <= 2);
});
