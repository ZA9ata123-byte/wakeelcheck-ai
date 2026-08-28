import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'wakeelcheck',
    demo: process.env['OPENROUTER_API_KEY'] === undefined && process.env['DEEPSEEK_API_KEY'] === undefined,
  });
}
