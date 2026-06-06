import { NextResponse } from 'next/server';
import { initDatabase } from '@/lib/db';

export async function GET() {
  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: '数据库表初始化成功' });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `初始化失败: ${e.message}` }, { status: 500 });
  }
}
