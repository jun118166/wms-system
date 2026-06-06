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
        const pdfjsLib = await import('pdfjs-dist');
        const pdfData = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        
        const allPdfRows: any[][] = [];
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          const yTolerance = 5;
          const rowMap = new Map<number, { y: number; items: { x: number; text: string }[] }>();
          
          for (const item of textContent.items) {
            const y = Math.round(item.transform[5]);
            const x = Math.round(item.transform[4]);
            const text = (item.str || '').trim();
            if (!text) continue;
            
            let foundKey: number | null = null;
            for (const [key] of rowMap) {
              if (Math.abs(key - y) <= yTolerance) { foundKey = key; break; }
            }
            const key = foundKey ?? y;
            if (!rowMap.has(key)) rowMap.set(key, { y: key, items: [] });
            rowMap.get(key)!.items.push({ x, text });
          }
          
          const sortedRows = [...rowMap.values()].sort((a, b) => a.y - b.y);
          for (const row of sortedRows) {
            row.items.sort((a, b) => a.x - b.x);
            allPdfRows.push(row.items.map(it => it.text));
          }
        }
        
        const rawText = allPdfRows.map(r => r.join('\t')).join('\n');
        
        return NextResponse.json({
          success: true,
          data: {
            sheets: [{
              name: 'pdf提取',
              previewRows: allPdfRows.slice(0, 100),
            }],
            rawText: rawText.substring(0, 10000),
            fileType: 'pdf',
            fileName: file.name,
          },
        });
      } catch (e: any) {
        return NextResponse.json({
          success: true,
          data: {
            sheets: [],
            rawText: `PDF解析失败: ${e.message}`,
            fileType: 'pdf',
            fileName: file.name,
          },
        });
      }
    }

    return NextResponse.json({ success: false, error: '不支持的文件格式' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
