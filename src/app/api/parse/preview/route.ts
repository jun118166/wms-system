import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

/** 预览文件内容（不执行完整解析，仅返回原始数据用于AI分析） */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ success: false, error: '未上传文件' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        return { name, previewRows: data.slice(0, 50) };
      });
      return NextResponse.json({ success: true, data: { sheets, fileType: 'excel', fileName: file.name } });
    }

    if (fileName.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({
        success: true,
        data: {
          sheets: [],
          rawText: result.value.substring(0, 5000),
          fileType: 'word',
          fileName: file.name,
        },
      });
    }

    if (fileName.endsWith('.pdf')) {
      try {
        const pdfParse = await import('pdf-parse');
        const pdfData = await pdfParse.default(buffer);
        const fullText = pdfData.text;
        
        const rawLines = fullText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        const headerLines: string[] = [];
        const dataLines: string[][] = [];
        const footerLines: string[] = [];
        let inFooter = false;
        
        for (const line of rawLines) {
          const dataMatch = line.match(/^(\d+)\s*(饮品类|熟烙类|自助调料类|冻品类|蔬菜类|粮油类|调味类|其他类)/);
          if (dataMatch) {
            const afterNum = line.substring(dataMatch[0].length);
            const fieldsMatch = afterNum.match(/^([A-Za-z0-9]+)\s*(.+?)\s*(\d+(?:\.\d+)?[^\s]*?(?:件|瓶|包|盒|袋|kg|g|个|箱|桶))\s*(件|瓶|包|盒|袋|个|箱|桶|kg)\s*(\d+)$/);
            if (fieldsMatch) {
              dataLines.push([dataMatch[1], dataMatch[2], fieldsMatch[1], fieldsMatch[2], fieldsMatch[3], fieldsMatch[4], fieldsMatch[5]]);
              continue;
            }
            const parts = afterNum.trim().split(/\s+/);
            if (parts.length >= 3) { dataLines.push([dataMatch[1], dataMatch[2], ...parts]); continue; }
          }
          if (inFooter || /收货机构|收货人|订货机构|联系电话|收货地址|签字|制单|合计|总计/.test(line)) {
            inFooter = true; footerLines.push(line); continue;
          }
          headerLines.push(line);
        }
        
        const allRows: any[][] = [
          ...headerLines.map((l: string) => [l]),
          ['序号', '类别', '物品编码', '物品名称', '规格', '单位', '数量'],
          ...dataLines,
          ...footerLines.map((l: string) => [l]),
        ];
        const rawText = allRows.map((r: any[]) => r.join('\t')).join('\n');
        
        return NextResponse.json({
          success: true,
          data: {
            sheets: [{ name: 'pdf提取', previewRows: allRows.slice(0, 100) }],
            rawText: rawText.substring(0, 10000),
            fileType: 'pdf',
            fileName: file.name,
          },
        });
      } catch (e: any) {
        return NextResponse.json({
          success: true,
          data: { sheets: [], rawText: `PDF解析失败: ${e.message}`, fileType: 'pdf', fileName: file.name },
        });
      }
    }

    return NextResponse.json({ success: false, error: '不支持的文件格式' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
