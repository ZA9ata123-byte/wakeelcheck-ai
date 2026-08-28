import { NextResponse } from 'next/server';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  let body: { email?: unknown; scanId?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; scanId?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof body.email !== 'string' || !EMAIL.test(body.email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // يُكتب في جدول leads حين تتوفّر قاعدة البيانات.
  console.info('[lead]', { scanId: body.scanId });
  return new NextResponse(null, { status: 204 });
}
