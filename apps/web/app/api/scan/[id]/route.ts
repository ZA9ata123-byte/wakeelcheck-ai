import { NextResponse } from 'next/server';
import { getScan } from '@/lib/scans';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scan = getScan(id);

  if (scan === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(scan);
}
