import { NextRequest, NextResponse } from 'next/server';
import { parseExcelBuffer, applyRule, findColumnIndex, autoDetectColumn } from '@/lib/rule-engine';
import type { ParseRule } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const ruleJson = formData.get('rule') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: '未上传文件' }, { status: 400 });
    }
    if (!ruleJson) {
      return NextResponse.json({ success: false, error: '未提供解析规则配置' }, { status: 400 });
    }

    let ruleRaw: any;
    try {
      ruleRaw = JSON.parse(ruleJson);
    } catch {
      return NextResponse.json({ success: false, error: '解析规则JSON格式错误' }, { status: 400 });
    }

    // Normalize: if columnMapping is array, convert to object using field name as key
    if (Array.isArray(ruleRaw.columnMapping)) {
      const obj: Record<string, any> = {};
      for (const m of ruleRaw.columnMapping) {
        const key = m.field || m.sourceColumn || '';
        if (key) obj[key] = m;
      }
      ruleRaw.columnMapping = obj;
    }
    
    // Ensure sourceType is valid
    if (ruleRaw.fileType && !ruleRaw.sourceType) {
      ruleRaw.sourceType = ruleRaw.fileType;
    }
    if (!ruleRaw.sourceType) {
      ruleRaw.sourceType = 'excel';
    }

    const rule = ruleRaw as ParseRule;

    // Debug info
    const debug = {
      ruleName: rule.name || 'unnamed',
      sourceType: rule.sourceType,
      extractionMode: rule.extractionMode,
      headerRowsToSkip: rule.headerRowsToSkip,
      footerRowsToSkip: rule.footerRowsToSkip,
      multiSheetMode: rule.multiSheetMode,
      columnMappingKeys: Object.keys(rule.columnMapping || {}),
      columnMappingCount: Object.keys(rule.columnMapping || {}).length,
      footerExtractionEnabled: rule.footerInfoExtraction?.enabled,
      groupByField: rule.groupByField,
    };
    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    let result;

    let firstSheetInfo: any = null;
    let parseTrace: any = null;

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const rawData = await parseExcelBuffer(arrayBuffer, file.name);
      
      // Capture full debug trace
      if (rawData.sheets.length > 0) {
        const s = rawData.sheets[0];
        const dataRows = s.rows.slice(rule.headerRowsToSkip);
        const effectiveRows = dataRows.slice(0, dataRows.length - rule.footerRowsToSkip);
        const headerRow = effectiveRows.length > 0 ? effectiveRows[0] : [];
        const firstDataRow = effectiveRows.length > 1 ? effectiveRows[1] : [];
        
        // Trace column mapping
        const mappingTrace: any[] = [];
        for (const [key, map] of Object.entries(rule.columnMapping || {})) {
          const targetField = (map as any).field || key;
          const colIdx = findColumnIndex(headerRow, (map as any).sourceColumn);
          const cellValue = colIdx >= 0 && colIdx < firstDataRow.length 
            ? String(firstDataRow[colIdx] || '').substring(0, 40) 
            : 'NOT_FOUND';
          const autoIdx = colIdx < 0 ? autoDetectColumn(headerRow, targetField) : -1;
          mappingTrace.push({
            objKey: key,
            targetField,
            sourceColumn: (map as any).sourceColumn,
            colIdx,
            cellValue,
            autoDetectIdx: autoIdx,
          });
        }
        
        parseTrace = {
          sheetName: s.name,
          totalRows: s.rowsCount,
          headerRow: headerRow.slice(0, 10).map((c: any) => String(c).substring(0, 30)),
          firstDataRow: firstDataRow.slice(0, 10).map((c: any) => String(c)),
          mappingTrace,
          hasColumnMapping: !!rule.columnMapping,
          columnMappingType: typeof rule.columnMapping,
        };
        
        firstSheetInfo = {
          sheetName: s.name,
          totalRows: s.rowsCount,
          headerSnippet: headerRow.slice(0, 10).map((c: any) => String(c).substring(0, 30)),
        };
      }
      
      result = await applyRule(rule, rawData);
      
      // Add first item data to trace
      if (result.data && result.data.length > 0) {
        const firstItem = result.data[0];
        parseTrace.firstParsedItem = {
          skuCode: firstItem.skuCode,
          skuName: firstItem.skuName,
          skuQuantity: firstItem.skuQuantity,
          skuSpec: firstItem.skuSpec,
        };
      }
    } else if (fileName.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const extractResult = await mammoth.extractRawText({ buffer });
      const rawData = {
        fileName: file.name,
        fileType: 'word' as const,
        sheets: [],
        rawText: extractResult.value,
      };
      result = await applyRule(rule, rawData);
    } else if (fileName.endsWith('.pdf')) {
      // PDF: extract text items with positions, rebuild table structure
      let pdfjsLib: any;
      try {
        pdfjsLib = await import('pdfjs-dist');
        const pdfData = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        
        const allPdfRows: any[][] = [];
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          // Group text items by Y-position (rows) with tolerance
          const yTolerance = 5;
          const rowMap = new Map<number, { y: number; items: { x: number; text: string }[] }>();
          
          for (const item of textContent.items) {
            const y = Math.round(item.transform[5]);
            const x = Math.round(item.transform[4]);
            const text = (item.str || '').trim();
            if (!text) continue;
            
            // Find existing row within tolerance
            let foundKey: number | null = null;
            for (const [key, row] of rowMap) {
              if (Math.abs(key - y) <= yTolerance) {
                foundKey = key;
                break;
              }
            }
            
            const key = foundKey ?? y;
            if (!rowMap.has(key)) {
              rowMap.set(key, { y: key, items: [] });
            }
            rowMap.get(key)!.items.push({ x, text });
          }
          
          // Sort rows by Y (top to bottom) and convert to columns
          const sortedRows = [...rowMap.values()].sort((a, b) => a.y - b.y);
          for (const row of sortedRows) {
            // Sort items by X (left to right)
            row.items.sort((a, b) => a.x - b.x);
            const cells = row.items.map(it => it.text);
            allPdfRows.push(cells);
          }
        }
        
        // Convert to sheets format
        const rawText = allPdfRows.map(r => r.join('\t')).join('\n');
        
        // Split into header area and table area based on table header detection
        const rawData = {
          fileName: file.name,
          fileType: 'pdf' as const,
          sheets: [{
            name: 'pdf',
            rows: allPdfRows,
            rowsCount: allPdfRows.length,
            colsCount: Math.max(...allPdfRows.map(r => r.length), 0),
          }],
          rawText,
        };
        
        // Capture debug info
        if (allPdfRows.length > 0) {
          const dataSlice = allPdfRows.slice(rule.headerRowsToSkip || 0, (rule.headerRowsToSkip || 0) + 5);
          parseTrace = {
            ...parseTrace,
            pdfRows: allPdfRows.length,
            pdfSample: dataSlice.map(r => r.slice(0, 8)),
          };
          firstSheetInfo = {
            sheetName: 'pdf',
            totalRows: allPdfRows.length,
            headerSnippet: allPdfRows.slice(0, Math.min(5, allPdfRows.length)).map(r => r.slice(0, 8)),
          };
        }
        
        result = await applyRule(rule, rawData);
      } catch (pdfErr: any) {
        // Fallback: try to parse as raw text
        const rawData = {
          fileName: file.name,
          fileType: 'pdf' as const,
          sheets: [],
          rawText: `PDF解析失败: ${pdfErr.message}`,
        };
        result = await applyRule(rule, rawData);
      }
    } else {
      return NextResponse.json({ success: false, error: '不支持的文件格式，请上传 Excel (.xlsx/.xls)、Word (.docx) 或 PDF 文件' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: { ...result, debug: { ...debug, trace: parseTrace }, firstSheetInfo } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
