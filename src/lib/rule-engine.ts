import type { ParseRule, OrderItem, ColumnMap, ParseResult, FooterInfoExtraction, MatrixConfig, CardConfig, TextConfig, SkipCondition } from './types';
import * as XLSX from 'xlsx';

// ===== Rule Engine =====

/** 应用解析规则到原始数据，返回结构化运单数据 */
export async function applyRule(rule: ParseRule, rawData: RawFileData): Promise<ParseResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let result: OrderItem[] = [];

  try {
    switch (rule.sourceType) {
      case 'excel':
        result = await parseExcelWithRule(rule, rawData, errors);
        break;
      case 'word':
        result = await parseWordWithRule(rule, rawData, errors);
        break;
      case 'pdf':
        result = await parsePdfWithRule(rule, rawData, errors);
        break;
      default:
        errors.push(`不支持的文件类型: ${rule.sourceType}`);
    }
  } catch (e: any) {
    errors.push(`解析异常: ${e.message}`);
  }

  // Apply post-processing
  result = postProcess(result, rule);

  const elapsed = Date.now() - startTime;
  return {
    success: errors.length === 0,
    data: result,
    errors,
    ruleUsed: rule.name,
    stats: {
      totalRows: rawData.rows?.length || rawData.sheets?.reduce((sum, s) => sum + s.rows.length, 0) || 0,
      parsedRows: result.length,
      skippedRows: 0,
      errors: errors.length,
      timeMs: elapsed,
    },
  };
}

// ===== Raw File Data Structures =====

export interface RawSheetData {
  name: string;
  rows: any[][];  // 2D array of cell values
  rowsCount: number;
  colsCount: number;
}

export interface RawFileData {
  fileName: string;
  fileType: 'excel' | 'word' | 'pdf';
  sheets: RawSheetData[];
  rows?: any[][];  // For single sheet convenience
  rawText?: string;  // For word/pdf
}

// ===== Excel Parser =====

export async function parseExcelBuffer(buffer: ArrayBuffer, fileName: string): Promise<RawFileData> {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets: RawSheetData[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    sheets.push({
      name: sheetName,
      rows: jsonData,
      rowsCount: jsonData.length,
      colsCount: jsonData.reduce((max, row) => Math.max(max, row.length), 0),
    });
  }

  return { fileName, fileType: 'excel', sheets, rows: sheets[0]?.rows };
}

function parseExcelWithRule(rule: ParseRule, rawData: RawFileData, errors: string[]): OrderItem[] {
  const allItems: OrderItem[] = [];

  let sheetsToProcess = rawData.sheets;
  if (rule.multiSheetMode === 'first') {
    sheetsToProcess = [rawData.sheets[0]];
  } else if (rule.multiSheetMode === 'specific' && rule.sheetNames) {
    sheetsToProcess = rawData.sheets.filter(s => rule.sheetNames!.includes(s.name));
  }

  for (const sheet of sheetsToProcess) {
    // Skip header rows
    const dataRows = sheet.rows.slice(rule.headerRowsToSkip);
    if (dataRows.length === 0) continue;

    // Extract footer info if configured
    let footerInfo: Record<string, string> = {};
    if (rule.footerInfoExtraction?.enabled) {
      footerInfo = extractFooterInfo(rule.footerInfoExtraction, sheet.rows);
    }

    if (rule.extractionMode === 'card' && rule.cardConfig?.enabled) {
      // Card-based extraction
      const cardItems = parseCards(rule, sheet.rows, footerInfo, errors);
      allItems.push(...cardItems);
    } else if (rule.extractionMode === 'matrix' && rule.matrixConfig?.enabled) {
      // Matrix transposition
      const matrixItems = parseMatrix(rule, sheet.rows, footerInfo, errors);
      allItems.push(...matrixItems);
    } else {
      // Standard row-based extraction
      // Detect end of data (before footer or empty rows)
      const effectiveRows = dataRows.slice(0, dataRows.length - rule.footerRowsToSkip);

      const headerRow = effectiveRows.length > 0 ? effectiveRows[0] : [];
      let dataStartIdx = 0;

      // Try to identify if first row is header by checking against column mapping
      const hasHeader = rule.columnMapping && Object.keys(rule.columnMapping).length > 0;

      if (hasHeader && effectiveRows.length > 1) {
        dataStartIdx = 1; // Skip header row
      }

      for (let i = dataStartIdx; i < effectiveRows.length; i++) {
        const row = effectiveRows[i];
        if (shouldSkipRow(row, rule.skipConditions)) continue;
        if (row.every((cell: any) => !cell || cell === '')) continue; // Skip empty rows

        const item = mapRowToOrder(row, headerRow, rule, footerInfo, sheet.name, i + rule.headerRowsToSkip);
        if (item) allItems.push(item);
      }
    }

    // Skip group-by inside loop — apply after all sheets processed
  }

  // Apply group-by aggregation after all sheets
  if (rule.groupByField) {
    return aggregateOrders(allItems, rule.groupByField);
  }

  return allItems;
}

function mapRowToOrder(
  row: any[],
  headerRow: any[],
  rule: ParseRule,
  footerInfo: Record<string, string>,
  sheetName: string,
  rowIndex: number
): OrderItem | null {
  const item: any = {
    externalCode: '',
    storeName: '',
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    skuCode: '',
    skuName: '',
    skuQuantity: 0,
    skuSpec: '',
    remark: '',
    __rowIndex: rowIndex,
  };

  for (const [_key, map] of Object.entries(rule.columnMapping)) {
    // Use map.field as the TARGET field name, NOT the object key
    const targetField = map.field || _key;
    let value: any = '';

    if (map.type === 'static') {
      value = map.staticValue || '';
    } else if (map.type === 'default') {
      value = map.defaultValue || '';
    } else if (map.type === 'direct') {
      let colIdx = map.sourceColumn ? findColumnIndex(headerRow, map.sourceColumn) : -1;
      
      // Fallback 1: sourceColumn is a number → use as direct index
      if (colIdx < 0 && map.sourceColumn && !isNaN(Number(map.sourceColumn))) {
        colIdx = Number(map.sourceColumn);
      }
      
      // Fallback 2: auto-detect by target field name
      if (colIdx < 0) {
        colIdx = autoDetectColumn(headerRow, targetField);
      }
      
      if (colIdx >= 0 && colIdx < row.length) {
        value = row[colIdx];
      }
    } else if (map.type === 'regex') {
      const rowStr = row.join(' ');
      if (map.regexPattern) {
        const match = rowStr.match(new RegExp(map.regexPattern));
        value = match && map.regexGroup !== undefined ? match[map.regexGroup] : (match ? match[0] : '');
      }
    } else if (map.type === 'composite') {
      const colIdx = map.sourceColumn ? findColumnIndex(headerRow, map.sourceColumn) : -1;
      if (colIdx >= 0 && colIdx < row.length) {
        value = row[colIdx];
      }
    }

    // Also check footerInfo (using targetField)
    if (!value && footerInfo[targetField]) {
      value = footerInfo[targetField];
    }

    // Also check staticValues and defaultValues (using targetField)
    if (!value && rule.staticValues[targetField]) {
      value = rule.staticValues[targetField];
    }
    if (!value && rule.defaultValues[targetField]) {
      value = rule.defaultValues[targetField];
    }

    // Assign to item using targetField
    if (targetField === 'skuQuantity') {
      (item as any)[targetField] = Number(value) || 0;
    } else {
      (item as any)[targetField] = String(value || '').trim();
    }
  }

  // Auto-detect columns for unmapped SKU fields (last resort)
  const skuFields = ['skuCode', 'skuName', 'skuQuantity', 'skuSpec'];
  for (const field of skuFields) {
    if (!item[field] || item[field] === '0') {
      const idx = autoDetectColumn(headerRow, field);
      if (idx >= 0 && idx < row.length && row[idx]) {
        const val = String(row[idx] || '').trim();
        if (val) {
          if (field === 'skuQuantity') {
            item[field] = Number(val) || 0;
          } else {
            item[field] = val;
          }
        }
      }
    }
  }

  // Always apply footerInfo for ALL fields (not just those in columnMapping)
  const orderFields = ['storeName', 'recipientName', 'recipientPhone', 'recipientAddress', 'externalCode', 'remark'];
  for (const field of orderFields) {
    if (!item[field] && footerInfo[field]) {
      item[field] = footerInfo[field];
    }
  }

  // Always apply staticValues and defaultValues
  for (const [field, val] of Object.entries(rule.staticValues || {})) {
    if (!item[field] && val) item[field] = val;
  }
  for (const [field, val] of Object.entries(rule.defaultValues || {})) {
    if (!item[field] && val) item[field] = val;
  }



  return item as OrderItem;
}

/** 当显式列名匹配失败时，根据目标字段自动检测列索引 */
export function autoDetectColumn(headerRow: any[], field: string): number {
  const fieldPatterns: Record<string, RegExp[]> = {
    skuCode: [/编码|code|货号/i, /sku.*码|物品.*码/i],
    skuName: [/名称|品名|name/i, /物品|商品|货品|产品/],
    skuQuantity: [/数量|件数|个数|qty|quantity/i],
    skuSpec: [/规格|型号|spec/i],
    externalCode: [/单号|运单|订单|外部/i],
    storeName: [/门店|店铺|收货门店/i],
    recipientName: [/收件人|收货人|联系人/i],
    recipientPhone: [/电话|手机|联系方式/i],
    recipientAddress: [/地址|addr/i],
    remark: [/备注|说明/i],
  };

  const patterns = fieldPatterns[field];
  if (!patterns) return -1;

  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '').trim();
    for (const pattern of patterns) {
      if (pattern.test(cell)) {
        return i;
      }
    }
  }

  return -1;
}

export function findColumnIndex(headerRow: any[], colName: string): number {
  if (!headerRow || headerRow.length === 0) return -1;
  const normalized = String(colName).trim().toLowerCase();
  
  // 1. Exact match or substring match
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '').trim().toLowerCase();
    if (cell === normalized || cell.includes(normalized) || normalized.includes(cell)) {
      return i;
    }
  }
  
  // 2. Keyword-based fuzzy match: extract key semantic words and match
  const keywords = extractKeywords(normalized);
  if (keywords.length > 0) {
    for (let i = 0; i < headerRow.length; i++) {
      const cell = String(headerRow[i] || '').trim().toLowerCase();
      const cellKeywords = extractKeywords(cell);
      // If they share at least one meaningful keyword, it's a match
      const overlap = keywords.filter(k => cellKeywords.includes(k));
      if (overlap.length >= 1 && overlap[0].length >= 2) {
        return i;
      }
    }
  }
  
  return -1;
}

/** 从列名中提取语义关键词 (如 "SKU物品编码" → ["编码", "sku"]) */
function extractKeywords(name: string): string[] {
  const keywords: string[] = [];
  
  // Common patterns in Chinese column names
  const patterns = [
    // SKU/编码 related
    { regex: /编码/, alias: '编码' },
    { regex: /sku/i, alias: 'sku' },
    { regex: /物品|商品|产品|货品/, alias: '物品' },
    // Name related
    { regex: /名称|品名/, alias: '名称' },
    // Quantity related
    { regex: /数量|件数|个数|数目/, alias: '数量' },
    { regex: /qty|quantity/i, alias: 'qty' },
    // Spec/Model related
    { regex: /规格|型号|规格型号/, alias: '规格' },
    { regex: /spec/i, alias: 'spec' },
    // External code
    { regex: /外部|配送单号|运单号|订单号/, alias: '单号' },
    { regex: /code|编号/i, alias: 'code' },
    // Store
    { regex: /门店|店铺|收货门店/, alias: '门店' },
    // Recipient
    { regex: /收件人|收货人|联系人/, alias: '收件人' },
    { regex: /电话|手机|联系方式/, alias: '电话' },
    { regex: /地址/, alias: '地址' },
    // Remark
    { regex: /备注|说明|附注/, alias: '备注' },
  ];
  
  for (const p of patterns) {
    if (p.regex.test(name)) {
      keywords.push(p.alias);
    }
  }
  
  return keywords;
}

function extractFooterInfo(config: FooterInfoExtraction, rows: any[][]): Record<string, string> {
  const info: Record<string, string> = {};
  if (!config.enabled) return info;

  // Look at the last N rows for footer info
  const footerRows = rows.slice(-10);

  for (const mapping of config.mappings) {
    for (const row of footerRows) {
      const rowStr = row.join(' ').trim();
      if (!rowStr) continue;

      if (config.searchPattern === 'label_value' && mapping.label) {
        // Search for label pattern like "收件人：张三"
        const pattern = mapping.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${pattern}[：:\\s]*(\\S+)`, 'i');
        const match = rowStr.match(regex);
        if (match) {
          const valuePart = rowStr.substring(match.index! + match[0].length - (match[1]?.length || 0));
          info[mapping.field] = (match[1] || valuePart).trim();
        }
      } else if (config.searchPattern === 'regex' && mapping.regex) {
        const match = rowStr.match(new RegExp(mapping.regex));
        if (match) {
          info[mapping.field] = match[1] || match[0] || '';
        }
      } else if (config.searchPattern === 'fixed_position') {
        if (mapping.rowOffset !== undefined && mapping.colOffset !== undefined) {
          const targetRow = rows[rows.length - Math.abs(mapping.rowOffset) + (mapping.rowOffset < 0 ? rows.length : 0)];
          if (targetRow && mapping.colOffset < targetRow.length) {
            info[mapping.field] = String(targetRow[mapping.colOffset] || '');
          }
        }
      }
    }
  }

  return info;
}

function shouldSkipRow(row: any[], conditions?: SkipCondition[]): boolean {
  if (!conditions || conditions.length === 0) return false;
  for (const cond of conditions) {
    if (cond.condition === 'row_empty') {
      if (row.every(c => !c || c === '')) return true;
    } else if (cond.condition === 'cell_contains' && cond.pattern) {
      const hasMatch = row.some(c => String(c || '').includes(cond.pattern!));
      if (hasMatch) return true;
    } else if (cond.condition === 'row_contains' && cond.pattern) {
      const rowStr = row.join(' ');
      if (rowStr.includes(cond.pattern)) return true;
    }
  }
  return false;
}

// ===== Card Parsing =====

function parseCards(rule: ParseRule, rows: any[][], footerInfo: Record<string, string>, errors: string[]): OrderItem[] {
  const items: OrderItem[] = [];
  const cardConfig = rule.cardConfig!;
  const cardPattern = new RegExp(cardConfig.cardStartPattern);

  let currentCardStart = -1;
  let currentCardInfo: Record<string, string> = {};
  const cards: { start: number; end: number; headerInfo: Record<string, string> }[] = [];

  // Find all card boundaries
  for (let i = 0; i < rows.length; i++) {
    const rowStr = rows[i].join(' ').trim();
    if (cardPattern.test(rowStr)) {
      if (currentCardStart >= 0) {
        cards.push({ start: currentCardStart, end: i, headerInfo: { ...currentCardInfo } });
      }
      currentCardStart = i;
      currentCardInfo = {};
    }
  }
  if (currentCardStart >= 0) {
    cards.push({ start: currentCardStart, end: rows.length, headerInfo: currentCardInfo });
  }

  // Parse each card
  for (const card of cards) {
    const cardRows = rows.slice(card.start, card.end);

    // Extract card header info
    for (const map of cardConfig.cardHeaderMapping) {
      if (map.type === 'regex' && map.regexPattern) {
        const cardStr = cardRows.map(r => r.join(' ')).join('\n');
        const match = cardStr.match(new RegExp(map.regexPattern));
        if (match) {
          card.headerInfo[map.field] = match[map.group || 1] || match[0] || '';
        }
      }
    }

    // Find inner table and parse items
    let tableStart = -1;
    let tableEnd = cardRows.length;

    if (cardConfig.cardTableStartPattern) {
      for (let j = 0; j < cardRows.length; j++) {
        if (cardRows[j].join(' ').includes(cardConfig.cardTableStartPattern)) {
          tableStart = j + 1;
          break;
        }
      }
    } else {
      tableStart = cardConfig.cardTableHeaderRow || 2;
    }

    for (let j = tableStart + 1; j < cardRows.length; j++) {
      const row = cardRows[j];
      if (row.every(c => !c)) break;
      const item = mapRowToOrder(row, cardRows[tableStart] || [], rule, { ...footerInfo, ...card.headerInfo }, '', card.start + j);
      if (item) items.push(item);
    }
  }

  return items;
}

// ===== Matrix Parsing =====

function parseMatrix(rule: ParseRule, rows: any[][], footerInfo: Record<string, string>, errors: string[]): OrderItem[] {
  const items: OrderItem[] = [];
  const mc = rule.matrixConfig!;
  if (!mc.enabled) return items;

  const headerRow = rows[mc.colHeaderRow - 1] || [];
  const colHeaders: { idx: number; value: string }[] = [];
  for (let c = mc.colHeaderStartCol - 1; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').trim();
    if (val) colHeaders.push({ idx: c, value: val });
  }

  for (let r = mc.dataStartRow - 1; r < rows.length; r++) {
    const row = rows[r];
    const rowLabel = String(row[mc.dataStartCol - 1] || '').trim();
    if (!rowLabel) continue;

    for (const ch of colHeaders) {
      const cellValue = String(row[ch.idx] || '').trim();
      if (!cellValue || cellValue === '0') continue;

      // Handle composite cells
      if (rule.compositeCellSplit?.enabled) {
        const parts = cellValue.split(rule.compositeCellSplit.delimiter || '\n');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const pattern = rule.compositeCellSplit.pattern || '{name}x{qty}';
          const regexPattern = pattern
            .replace('{name}', '(\\S+)')
            .replace('{qty}', '(\\d+)');
          const match = trimmed.match(new RegExp(regexPattern));
          if (match) {
            const item: OrderItem = {
              externalCode: '',
              storeName: '',
              recipientName: '',
              recipientPhone: '',
              recipientAddress: '',
              skuCode: '',
              skuName: match[1] || trimmed,
              skuQuantity: Number(match[2]) || 0,
              skuSpec: '',
              remark: '',
              ...footerInfo,
            };
            (item as any)[mc.rowLabelField] = rowLabel;
            (item as any)[mc.colHeaderIsField] = ch.value;
            items.push(item);
          }
        }
      } else {
        const item: OrderItem = {
          externalCode: '',
          storeName: '',
          recipientName: '',
          recipientPhone: '',
          recipientAddress: '',
          skuCode: '',
          skuName: rowLabel,
          skuQuantity: Number(cellValue) || 0,
          skuSpec: '',
          remark: '',
          ...footerInfo,
        };
        (item as any)[mc.colHeaderIsField] = ch.value;
        items.push(item);
      }
    }
  }

  return items;
}

// ===== Word Parsing =====

function parseWordWithRule(rule: ParseRule, rawData: RawFileData, errors: string[]): OrderItem[] {
  const items: OrderItem[] = [];
  if (!rawData.rawText || !rule.textConfig?.enabled) return items;

  const tc = rule.textConfig;
  const records = rawData.rawText.split(new RegExp(tc.recordSeparator)).filter(r => r.trim());

  for (const record of records) {
    const recordInfo: Record<string, string> = {};

    // Extract field values using patterns
    for (const parser of tc.fieldParsers) {
      const match = record.match(new RegExp(parser.pattern, 'i'));
      if (match) {
        recordInfo[parser.field] = match[parser.group || 1] || match[0] || '';
      }
    }

    // Extract items
    const itemMatches = record.matchAll(new RegExp(tc.itemPattern, 'gm'));
    for (const match of itemMatches) {
      const item: OrderItem = {
        externalCode: recordInfo['externalCode'] || '',
        storeName: recordInfo['storeName'] || '',
        recipientName: recordInfo['recipientName'] || '',
        recipientPhone: recordInfo['recipientPhone'] || '',
        recipientAddress: recordInfo['recipientAddress'] || '',
        skuCode: match[1] || '',
        skuName: match[2] || '',
        skuQuantity: Number(match[4]) || 0,
        skuSpec: match[3] || '',
        remark: recordInfo['remark'] || '',
      };
      items.push(item);
    }
  }

  return items;
}

// ===== PDF Parsing =====

async function parsePdfWithRule(rule: ParseRule, rawData: RawFileData, errors: string[]): Promise<OrderItem[]> {
  // PDF parsing uses extracted text from pdfjs-dist
  // The rawText should already contain the extracted text
  const items: OrderItem[] = [];
  if (!rawData.rawText) {
    errors.push('PDF文本提取失败');
    return items;
  }

  // Use the same logic as excel row parsing but with the text converted to rows
  const lines = rawData.rawText.split('\n').filter(l => l.trim());
  const virtualRows = lines.map(l => [l]);

  // For PDF, try to use text config first, fall back to row-based
  if (rule.textConfig?.enabled) {
    return parseWordWithRule(rule, rawData, errors);
  }

  // Row-based approach for PDF
  const allText = lines.join(' || ');
  // Create virtual rows by splitting on potential row boundaries
  const processedRows = lines.map(line => {
    // Split by tabs, multiple spaces, or pipe characters
    return line.split(/\t+|  +|\|/).map(c => c.trim()).filter(c => c);
  }).filter(row => row.length > 0);

  const sheetLike = {
    name: 'pdf',
    rows: processedRows,
    rowsCount: processedRows.length,
    colsCount: Math.max(...processedRows.map(r => r.length)),
  };

  // Process footer extraction
  const footerInfo = rule.footerInfoExtraction?.enabled
    ? extractFooterInfo(rule.footerInfoExtraction, processedRows)
    : {};

  const dataRows = processedRows.slice(rule.headerRowsToSkip);
  const headerRow = dataRows.length > 0 ? dataRows[0] : [];
  const dataStartIdx = 1;

  for (let i = dataStartIdx; i < dataRows.length - rule.footerRowsToSkip; i++) {
    const row = dataRows[i];
    if (row.every(c => !c)) continue;
    const item = mapRowToOrder(row, headerRow, rule, footerInfo, '', i + rule.headerRowsToSkip);
    if (item && item.skuName) items.push(item);
  }

  return items;
}

// ===== Post Processing =====

function postProcess(items: OrderItem[], rule: ParseRule): OrderItem[] {
  // Apply composite cell splitting for row mode
  if (rule.compositeCellSplit?.enabled && rule.extractionMode === 'row') {
    const newItems: OrderItem[] = [];
    for (const item of items) {
      const fieldValue = (item as any)[rule.compositeCellSplit.field];
      if (fieldValue && typeof fieldValue === 'string') {
        const parts = fieldValue.split(rule.compositeCellSplit.delimiter || '\n');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const pattern = rule.compositeCellSplit.pattern || '{name}x{qty}';
          const regexPattern = pattern
            .replace('{name}', '(\\S+)')
            .replace('{qty}', '(\\d+)');
          const match = trimmed.match(new RegExp(regexPattern));
          const newItem = { ...item };
          if (match) {
            (newItem as any)[rule.compositeCellSplit.field.replace('skuQuantity', 'skuName')] = match[1] || trimmed;
            newItem.skuQuantity = Number(match[2]) || 0;
          }
          newItems.push(newItem);
        }
      } else {
        newItems.push(item);
      }
    }
    return newItems;
  }

  return items;
}

function aggregateOrders(items: OrderItem[], groupField: string): OrderItem[] {
  return items; // For now, items are preserved individually
}

// ===== Validation =====

export function validateOrderItems(items: OrderItem[]): OrderItem[] {
  return items.map((item, idx) => {
    const errors: any[] = [];

    // Check A组 (门店模式) vs B组 (收件人模式) - at least one group required
    const hasGroupA = !!item.storeName;
    const hasGroupB = !!(item.recipientName && item.recipientPhone && item.recipientAddress);
    if (!hasGroupA && !hasGroupB) {
      errors.push({ rowIndex: idx, field: 'storeName/recipientInfo', message: '门店信息(A组)或收件人信息(B组)至少填写一组' });
    }

    // Required fields
    if (!item.skuCode) errors.push({ rowIndex: idx, field: 'skuCode', message: 'SKU编码不能为空' });
    if (!item.skuName) errors.push({ rowIndex: idx, field: 'skuName', message: 'SKU名称不能为空' });
    if (!item.skuQuantity || item.skuQuantity <= 0) {
      errors.push({ rowIndex: idx, field: 'skuQuantity', message: '发货数量必须为正数' });
    }

    // Phone format validation
    if (item.recipientPhone && !/^1[3-9]\d{9}$/.test(item.recipientPhone.replace(/\s|-/g, ''))) {
      errors.push({ rowIndex: idx, field: 'recipientPhone', message: '电话格式不正确' });
    }

    return { ...item, __errors: errors, __rowIndex: idx };
  });
}

export function findDuplicates(items: OrderItem[], existingCodes: string[]): OrderItem[] {
  const seen = new Map<string, number>();
  return items.map((item, idx) => {
    const code = item.externalCode;
    if (!code) return item;

    if (existingCodes.includes(code)) {
      return { ...item, __duplicateWith: '数据库已存在' };
    }
    if (seen.has(code)) {
      return { ...item, __duplicateWith: `与第 ${seen.get(code)! + 1} 行重复` };
    }
    seen.set(code, idx);
    return item;
  });
}
