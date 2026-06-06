import { NextRequest, NextResponse } from 'next/server';
import { generateRuleFromAI, checkAiConnection } from '@/lib/ai-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName, fileType, previewData } = body;

    if (!previewData) {
      return NextResponse.json({ success: false, error: '缺少文件预览数据' }, { status: 400 });
    }

    const result = await generateRuleFromAI({ fileName, fileType, previewData });
    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `AI生成规则失败: ${e.message}` }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await checkAiConnection();
    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, data: { connected: false, model: '' } }, { status: 500 });
  }
}
