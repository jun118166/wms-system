import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import type { OrderItem } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orders, batchId } = body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ success: false, error: '没有待提交的数据' }, { status: 400 });
    }

    // Validate all orders before submission
    const invalidOrders: { row: number; message: string }[] = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i] as OrderItem;
      if (o.__errors && o.__errors.length > 0) {
        invalidOrders.push({ row: i + 1, message: o.__errors.map(e => e.message).join('; ') });
      }
    }
    if (invalidOrders.length > 0) {
      return NextResponse.json({
        success: false,
        error: '存在校验不通过的数据，请修正后再提交',
        invalidOrders,
      }, { status: 400 });
    }

    // Check duplicate external codes
    const codes = orders.map(o => o.externalCode).filter(Boolean);
    const existingCodes = await db.checkDuplicateExternalCodes(codes);
    if (existingCodes.length > 0) {
      return NextResponse.json({
        success: false,
        error: `以下外部编码已存在: ${existingCodes.join(', ')}`,
      }, { status: 400 });
    }

    // Insert orders
    const batch = batchId || uuidv4();
    const orderRecords = orders.map((o: OrderItem) => ({
      id: uuidv4(),
      batchId: batch,
      externalCode: o.externalCode || '',
      storeName: o.storeName || '',
      recipientName: o.recipientName || '',
      recipientPhone: o.recipientPhone || '',
      recipientAddress: o.recipientAddress || '',
      skuCode: o.skuCode,
      skuName: o.skuName,
      skuQuantity: Number(o.skuQuantity) || 0,
      skuSpec: o.skuSpec || '',
      remark: o.remark || '',
    }));

    const results = await db.insertOrders(orderRecords);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      data: {
        batchId: batch,
        total: orders.length,
        successCount,
        failCount,
        errors: results.filter(r => !r.success).map(r => ({ row: 0, message: r.error })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `提交失败: ${e.message}` }, { status: 500 });
  }
}
