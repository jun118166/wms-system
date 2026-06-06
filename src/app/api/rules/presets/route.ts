import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

/** 预置解析规则 - 多门店分Sheet出库单 */
const presets = [
  {
    id: 'preset-multi-sheet',
    name: '多门店分Sheet出库单（通用）',
    description: '适用于：多门店分Sheet出库单，每Sheet一个门店，表头有标准列名，底部有收货人信息',
    config: {
      sourceType: 'excel',
      extractionMode: 'row',
      headerRowsToSkip: 3,
      footerRowsToSkip: 6,
      multiSheetMode: 'merge',
      groupByField: '',
      footerInfoExtraction: {
        enabled: true,
        searchPattern: 'label_value',
        mappings: [
          { field: 'storeName', label: '收货门店' },
          { field: 'recipientName', label: '联系人' },
          { field: 'recipientPhone', label: '联系电话' },
          { field: 'recipientAddress', label: '收货地址' },
        ],
      },
      columnMapping: {
        skuCode: { field: 'skuCode', sourceColumn: '物品编码', type: 'direct' },
        skuName: { field: 'skuName', sourceColumn: '物品名称', type: 'direct' },
        skuQuantity: { field: 'skuQuantity', sourceColumn: '出库数量', type: 'direct' },
        skuSpec: { field: 'skuSpec', sourceColumn: '规格型号', type: 'direct' },
        remark: { field: 'remark', sourceColumn: '备注', type: 'direct' },
      },
      skipConditions: [
        { condition: 'row_contains', pattern: '合计' },
        { condition: 'row_contains', pattern: '小计' },
      ],
      defaultValues: {},
      staticValues: {},
    },
  },
];

export async function POST() {
  try {
    const results = [];
    for (const preset of presets) {
      try {
        await db.createRule(preset.id, preset.name, preset.description, preset.config);
        results.push({ id: preset.id, name: preset.name, status: 'created' });
      } catch (e: any) {
        results.push({ id: preset.id, name: preset.name, status: 'exists' });
      }
    }
    return NextResponse.json({ success: true, data: { results, presets } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, data: presets });
}
