import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const externalCode = searchParams.get('externalCode') || '';
    const recipientName = searchParams.get('recipientName') || '';
    const dateFrom = searchParams.get('dateFrom') || '';

    const result = await db.getOrders({ page, pageSize, externalCode, recipientName, dateFrom });
    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
