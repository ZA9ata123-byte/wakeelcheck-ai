import { NextResponse } from 'next/server';
import { StoreUnavailableError } from '@wakeelcheck/limits';
import { getScan } from '@/lib/scans';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const scan = await getScan(id);
    if (scan === null) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(scan);
  } catch (err) {
    // الواجهة تعيد المحاولة على أي ردٍّ غير ناجح، فعطلٌ عابر في المخزن لا
    // يُسقط الفحص أمام التاجر.
    if (err instanceof StoreUnavailableError) {
      return NextResponse.json({ error: 'store_unavailable' }, { status: 503 });
    }
    throw err;
  }
}
