import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { codes } = await req.json();
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ existingCodes: [] });
    }

    const existingCodes = await db.checkDuplicateExternalCodes(codes);
    return NextResponse.json({ existingCodes });
  } catch (e: any) {
    return NextResponse.json({ existingCodes: [] });
  }
}
