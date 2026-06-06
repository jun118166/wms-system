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
        // 直接导入内部模块，绕过 index.js 中的 isDebugMode 测试文件读取
        // @ts-ignore - pdf-parse 内部模块无类型声明
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default || (await import('pdf-parse/lib/pdf-parse.js'));
        const pdfData = await pdfParse(buffer);
        const fullText = pdfData.text;
        
        const rawLines = fullText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        const headerLines: string[] = [];
        const dataLines: string[][] = [];
        const footerLines: string[] = [];
        let inFooter = false;
        
        for (const line of rawLines) {
          // Detect data rows: sequence number + Chinese category + alphanumeric SKU code
          // Use generic pattern to match ANY category, not just a whitelist
          const dataMatch = line.match(/^(\d+)\s*([\u4e00-\u9fff]+(?:类|服)?)\s*([A-Za-z]\w*)/);
          if (dataMatch && dataMatch[2].length <= 6 && dataMatch[3].length >= 4) {
            // If we were in footer mode but hit a data row, reset
            if (inFooter) inFooter = false;
            const seqNum = dataMatch[1];
            const category = dataMatch[2];
            const afterCode = line.substring(dataMatch[0].length);
            const skuCode = dataMatch[3];
            // Try structured parse: name + spec + unit + quantity
            const fieldsMatch = afterCode.match(/^\s*(.+?)\s*(\d+(?:\.\d+)?[^\s]*?(?:件|瓶|包|盒|袋|kg|g|个|箱|桶|码))\s*(件|瓶|包|盒|袋|个|箱|桶|kg)\s*(\d+)$/);
            if (fieldsMatch) {
              dataLines.push([seqNum, category, skuCode, fieldsMatch[1], fieldsMatch[2], fieldsMatch[3], fieldsMatch[4]]);
              continue;
            }
            const parts = afterCode.trim().split(/\s+/);
            if (parts.length >= 3) { dataLines.push([seqNum, category, skuCode, ...parts]); continue; }
          }
          // Footer detection: only trigger if the line is NOT a multi-value info line
          // (lines like "单据编号：...单据状态：...收货机构：..." contain footer keywords
          //  but are actually header info lines with 3+ label-value pairs)
          const headerInfoCount = (line.match(/单据编号|单据状态|复审状态|分拣状态|订单日期|发货日期|预计发货|期望到货|是否需要/g) || []).length;
          const isMultiValueInfoLine = headerInfoCount >= 2;
          if (!isMultiValueInfoLine && (inFooter || /收货机构|收货人|订货机构|联系电话|收货地址|签字|制单|合计|总计/.test(line))) {
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
