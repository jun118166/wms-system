import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const rules = await db.getAllRules();
    return NextResponse.json({ success: true, data: rules });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, description, config } = body;
    if (!id || !name) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }
    const rule = await db.createRule(id, name, description || '', config);
    return NextResponse.json({ success: true, data: rule });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
