import { after } from 'next/server';
import { handleScanPost } from '@/lib/scan-post';
import { startScan, store } from '@/lib/scans';

/**
 * سقف المنصّة بالثواني. يجب أن يطابق `PLATFORM_LIMIT_MS` في `lib/launch.ts`.
 *
 * Next يقرؤه نصّاً ثابتاً عند البناء لا تعبيراً، فلا يمكن استيراده من هناك.
 * فالرقم مكرَّر مضطرّاً، واختبارٌ في `test/launch.test.ts` يحرس تطابقهما.
 */
export const maxDuration = 60;

/**
 * المنطق كلّه في `lib/scan-post.ts` ويُختبر هناك. هذا محوّلٌ يحقن العالم:
 * المخزن، والبيئة، والساعة، و`after()` — وهو ما يضمن أن الفحص الذي يكمل
 * خلف الردّ يكمل فعلاً، لا أن يُترك لحظّ المنصّة.
 */
export function POST(req: Request): Promise<Response> {
  return handleScanPost(req, {
    store,
    start: startScan,
    schedule: (task) => after(task),
    env: (name) => process.env[name],
    now: () => new Date(),
  });
}
