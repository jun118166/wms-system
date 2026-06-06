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

/** 智能检测实际表头行：在 headerRowsToSkip 范围内的行中，找到最像表头的行 */
function detectActualHeaderRow(rows: any[][], maxScan: number, columnMapping?: Record<string, ColumnMap>): number {
  const sourceColumns = columnMapping
    ? Object.values(columnMapping).map(m => m.sourceColumn).filter(Boolean)
    : [];

  // Common column header keywords (Chinese & English)
  const headerKeywords = [
    '序号', '编号', '编码', '品名', '名称', '数量', '规格', '型号', '单位',
    '单价', '金额', '备注', '仓库', '日期',
    'code', 'name', 'qty', 'quantity', 'spec', 'sku', 'price', 'remark',
  ];

  let bestIdx = -1;
  let bestScore = 0;
  const scanEnd = Math.min(maxScan, rows.length);

  for (let i = 0; i < scanEnd; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    let score = 0;
    let nonEmptyCells = 0;

    for (const cell of row) {
      const cellText = String(cell || '').trim();
      if (!cellText) continue;
      nonEmptyCells++;

      // Check against known source column names from columnMapping (highest priority)
      for (const src of sourceColumns) {
        if (src && (cellText.includes(src) || src.includes(cellText))) {
          score += 3;
        }
      }

      // Check against generic header keywords
      const lowerCell = cellText.toLowerCase();
      for (const kw of headerKeywords) {
        if (cellText === kw || (cellText.length <= 10 && cellText.includes(kw))) {
          score += 1;
          break;
        }
      }

      // Penalize cells that look like data values (numbers, product codes, etc.)
      if (/^\d+$/.test(cellText)) score -= 1;
    }

    // Prefer rows with more non-empty cells (real headers tend to have many columns)
    if (nonEmptyCells >= 4) score += nonEmptyCells;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // Require a minimum score to confirm it's a header (at least 2 keyword matches)
  return bestScore >= 4 ? bestIdx : -1;
}

/** 自动检测矩阵表格结构：表头包含多个门店/渠道名列，数据区为数量 */
function autoDetectMatrixStructure(
  headerRow: any[], dataRows: any[][], headerRowIdx: number
): { detected: boolean; config?: any } {
  if (!headerRow || headerRow.length < 5 || dataRows.length < 2) return { detected: false };

  // 分析每列的特征：是"门店列"（短文本标题+数字数据）还是"元数据列"
  const storeLikeCols: number[] = [];
  const metaCols: number[] = [];

  for (let c = 0; c < headerRow.length; c++) {
    const header = String(headerRow[c] || '').trim();
    if (!header) continue;

    // 跳过汇总/元数据列
    if (isSummaryColumn(header) || isMetadataColumn(header)) {
      metaCols.push(c);
      continue;
    }

    // 检查该列的数据是否为数字为主（门店列的单元格值应是数量）
    let numericCount = 0;
    let totalChecked = 0;
    const sampleEnd = Math.min(dataRows.length, 15);
    for (let r = 0; r < sampleEnd; r++) {
      const cellVal = String(dataRows[r]?.[c] ?? '').trim();
      if (!cellVal) continue;
      totalChecked++;
      if (/^\d+(\.\d+)?$/.test(cellVal)) numericCount++;
    }

    // 短列头（≤6字）且非汇总/元数据 → 很可能是门店名，放宽数值要求
    const looksLikeStoreName = header.length <= 6 && header.length >= 2;
    const minRatio = looksLikeStoreName ? 0.1 : 0.5;

    if (looksLikeStoreName && totalChecked === 0) {
      // 完全空列但列头像门店名（如"门店B"前几行没数据）→ 仍然识别为门店列
      storeLikeCols.push(c);
    } else if (totalChecked > 0 && numericCount / totalChecked >= minRatio) {
      storeLikeCols.push(c);
    } else if (header.length <= 20) {
      // 短标题但非数字数据 → 可能是元数据列
      metaCols.push(c);
    }
  }

  // 至少3个门店列才认为是矩阵
  if (storeLikeCols.length < 3) return { detected: false };

  // 找到行标签列（最后一个非门店、非汇总的文本列，通常是SKU名称）
  let rowLabelCol = -1;
  let skuCodeCol = -1;
  let externalCodeCol = -1;
  let skuSpecCol = -1;

  for (let c = 0; c < headerRow.length; c++) {
    const header = String(headerRow[c] || '').trim();
    if (storeLikeCols.includes(c)) continue;
    if (isSummaryColumn(header)) continue;

    const lower = header.toLowerCase();
    if (/sku.*名|品名|物品名|商品名|产品名|名称/.test(lower) && rowLabelCol < 0) {
      rowLabelCol = c;
    } else if (/sku.*码|条码|编码|代码/.test(lower) && skuCodeCol < 0) {
      skuCodeCol = c;
    } else if (/外部.*编码|外部.*码|商品编码/.test(lower) && externalCodeCol < 0) {
      externalCodeCol = c;
    } else if (/规格|型号/.test(lower) && skuSpecCol < 0) {
      skuSpecCol = c;
    }
  }

  // 如果没找到明确的行标签列，取第一个非门店非汇总的文本列
  if (rowLabelCol < 0) {
    for (let c = 0; c < headerRow.length; c++) {
      if (!storeLikeCols.includes(c) && !metaCols.includes(c)) {
        const header = String(headerRow[c] || '').trim();
        if (header && header.length <= 30) {
          rowLabelCol = c;
          break;
        }
      }
    }
  }

  if (rowLabelCol < 0) return { detected: false };

  const colHeaderStartCol = Math.min(...storeLikeCols) + 1; // 1-based
  const rowFields: { field: string; col: number }[] = [];
  if (skuCodeCol >= 0) rowFields.push({ field: 'skuCode', col: skuCodeCol + 1 });
  if (externalCodeCol >= 0) rowFields.push({ field: 'externalCode', col: externalCodeCol + 1 });
  if (skuSpecCol >= 0) rowFields.push({ field: 'skuSpec', col: skuSpecCol + 1 });

  return {
    detected: true,
    config: {
      enabled: true,
      rowLabelField: 'skuName',
      colHeaderStartCol,
      colHeaderRow: headerRowIdx + 1, // 1-based
      dataStartRow: headerRowIdx + 2, // 1-based, row after header
      dataStartCol: rowLabelCol + 1,  // 1-based
      colHeaderIsField: 'storeName',
      transposeValueField: 'skuQuantity',
      rowFields,
    },
  };
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
    // Smart header detection: scan a generous range for the actual header
    // AI might set headerRowsToSkip too low or too high, so we scan up to 10 rows
    let actualHeaderRowIdx = -1;
    const scanRange = Math.max(rule.headerRowsToSkip, Math.min(10, Math.floor(sheet.rows.length / 2)));
    if (scanRange > 0) {
      actualHeaderRowIdx = detectActualHeaderRow(sheet.rows, scanRange, rule.columnMapping);
    }

    let headerRow: any[];
    let dataRows: any[][];

    if (actualHeaderRowIdx >= 0) {
      // Found actual header in skipped area — use it and start data from next row
      headerRow = sheet.rows[actualHeaderRowIdx];
      dataRows = sheet.rows.slice(actualHeaderRowIdx + 1);
    } else {
      // Fallback to original behavior
      dataRows = sheet.rows.slice(rule.headerRowsToSkip);
      if (dataRows.length === 0) continue;

      // After trimming footer, try to use the first remaining row as header
      const effectiveForHeader = dataRows.slice(0, dataRows.length - rule.footerRowsToSkip);
      headerRow = effectiveForHeader.length > 0 ? effectiveForHeader[0] : [];
    }

    if (dataRows.length === 0) continue;

    // Extract footer info if configured (uses ALL original rows)
    let footerInfo: Record<string, string> = {};
    if (rule.footerInfoExtraction?.enabled) {
      footerInfo = extractFooterInfo(rule.footerInfoExtraction, sheet.rows);
    }

    if (rule.extractionMode === 'card' && rule.cardConfig?.enabled) {
      // Card-based extraction
      const cardItems = parseCards(rule, sheet.rows, footerInfo, errors);
      allItems.push(...cardItems);
    } else if (rule.extractionMode === 'matrix' && rule.matrixConfig?.enabled) {
      // Matrix transposition (AI-configured)
      const matrixItems = parseMatrix(rule, sheet.rows, footerInfo, errors);
      allItems.push(...matrixItems);
    } else {
      // 自动检测矩阵结构：如果表头有多个"门店列"（数据为数字），自动切换为矩阵模式
      const headerIdxForMatrix = actualHeaderRowIdx >= 0 ? actualHeaderRowIdx : rule.headerRowsToSkip;
      const matrixDataRows = sheet.rows.slice(headerIdxForMatrix + 1);
      const matrixDetect = autoDetectMatrixStructure(headerRow, matrixDataRows, headerIdxForMatrix);

      if (matrixDetect.detected && matrixDetect.config) {
        // 自动矩阵模式
        const autoRule: ParseRule = {
          ...rule,
          extractionMode: 'matrix',
          matrixConfig: matrixDetect.config,
        };
        const matrixItems = parseMatrix(autoRule, sheet.rows, footerInfo, errors);
        if (matrixItems.length > 0) {
          allItems.push(...matrixItems);
          continue; // 跳过标准行解析
        }
      }

      // 自动检测卡片式结构（如"▶ 调拨记录 #1"）
      const cardStartMatch = autoDetectCardStructure(sheet.rows);
      if (cardStartMatch) {
        const autoCardConfig = {
          enabled: true,
          cardStartPattern: cardStartMatch.cardStartPattern,
          cardTableStartPattern: cardStartMatch.cardTableStartPattern,
          cardHeaderMapping: cardStartMatch.cardHeaderMapping,
          cardTableMapping: [],
        };
        const autoCardRule: ParseRule = {
          ...rule,
          extractionMode: 'card',
          cardConfig: autoCardConfig,
        };
        const cardItems = parseCards(autoCardRule, sheet.rows, footerInfo, errors);
        if (cardItems.length > 0) {
          allItems.push(...cardItems);
          continue;
        }
      }

      // Standard row-based extraction
      // Detect end of data (before footer or empty rows)
      const effectiveRows = dataRows.slice(0, dataRows.length - rule.footerRowsToSkip);

      let dataStartIdx = 0;

      // If we didn't do smart detection, try to skip header row in data
      if (actualHeaderRowIdx < 0) {
        const hasHeader = rule.columnMapping && Object.keys(rule.columnMapping).length > 0;
        if (hasHeader && effectiveRows.length > 1) {
          dataStartIdx = 1; // Skip header row
        }
      }

      for (let i = dataStartIdx; i < effectiveRows.length; i++) {
        const row = effectiveRows[i];
        if (shouldSkipRow(row, rule.skipConditions)) continue;
        if (row.every((cell: any) => !cell || cell === '')) continue; // Skip empty rows

        const item = mapRowToOrder(row, headerRow, rule, footerInfo, sheet.name, i + (actualHeaderRowIdx >= 0 ? actualHeaderRowIdx + 1 : rule.headerRowsToSkip));
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
    skuCode: [/编码|code|货号/i, /sku.*码|物品.*码|产品.*码|商品.*码/i, /^sku$/i],
    skuName: [/名称|品名|name/i, /物品|商品|货品|产品/, /sku.*名|物品名/i],
    skuQuantity: [/数量|件数|个数|qty|quantity/i, /出库|发货|出货/i],
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
  
  // 1. Exact match
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '').trim().toLowerCase();
    if (cell === normalized) return i;
  }

  // 2. Substring match (with cross-domain conflict protection)
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '').trim().toLowerCase();
    if (cell.includes(normalized) || normalized.includes(cell)) {
      // Reject if the match is only due to a shared generic word (like "编码")
      // while the specific qualifiers indicate different domains
      if (hasCrossDomainConflict(normalized, cell)) continue;
      return i;
    }
  }
  
  // 3. Keyword-based fuzzy match: extract key semantic words and match
  const keywords = extractKeywords(normalized);
  if (keywords.length > 0) {
    for (let i = 0; i < headerRow.length; i++) {
      const cell = String(headerRow[i] || '').trim().toLowerCase();
      const cellKeywords = extractKeywords(cell);
      // If they share at least one meaningful keyword, it's a match
      const overlap = keywords.filter(k => cellKeywords.includes(k));
      if (overlap.length >= 1 && overlap[0].length >= 2) {
        // Reject cross-domain fuzzy matches
        if (hasCrossDomainConflict(normalized, cell)) continue;
        return i;
      }
    }
  }
  
  return -1;
}

/**
 * 检测两个列名是否因特定关键词不同而不应匹配
 * 防止"SKU编码"→"物品编码"、"外部编码"→"物品编码" 等错误映射
 */
function hasCrossDomainConflict(source: string, target: string): boolean {
  // 跨域检测：SKU/物品域 vs 单据/订单域
  const skuDomain = /sku|物品|商品|产品|货品|货号|品名|货物/;
  const orderDomain = /外部|单号|单据|运单|订单|配送单|物流/;

  if ((skuDomain.test(source) && orderDomain.test(target)) ||
      (orderDomain.test(source) && skuDomain.test(target))) {
    return true;
  }

  // 特定关键词冲突：双方各有对方没有的特定概念词（排除通用词"编码/code/编号"）
  const synonymGroups = [
    ['sku'],
    ['物品', '商品', '产品', '货品', '货物'],
    ['外部', '订单', '运单', '配送单', '单据'],
    ['货号'],
  ];

  const sourceSpecifics = new Set<string>();
  const targetSpecifics = new Set<string>();

  for (const group of synonymGroups) {
    const inSource = group.some(t => new RegExp(t, 'i').test(source));
    const inTarget = group.some(t => new RegExp(t, 'i').test(target));
    if (inSource && !inTarget) sourceSpecifics.add(group[0]);
    if (inTarget && !inSource) targetSpecifics.add(group[0]);
  }

  if (sourceSpecifics.size > 0 && targetSpecifics.size > 0) {
    return true;
  }

  // 组内字面量检测：双方都命中同一词组，但使用了组内不同的具体词
  // 例如 "商品编码" vs "物品编码"（同组不同词 → 冲突）
  // 但 "配送单号" vs "单据号" 不冲突（"单据" 是 "配送单" 的子串）
  for (const group of synonymGroups) {
    if (group.length < 2) continue;
    const inSource = group.some(t => new RegExp(t, 'i').test(source));
    const inTarget = group.some(t => new RegExp(t, 'i').test(target));
    if (!inSource || !inTarget) continue;

    // 取最长匹配项（最具体的词），避免子串重复匹配
    const sourceBest = group
      .filter(t => new RegExp(t, 'i').test(source))
      .sort((a, b) => b.length - a.length)[0];
    const targetBest = group
      .filter(t => new RegExp(t, 'i').test(target))
      .sort((a, b) => b.length - a.length)[0];
    if (sourceBest !== targetBest &&
        !sourceBest.includes(targetBest) &&
        !targetBest.includes(sourceBest)) {
      return true;
    }
  }

  return false;
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
    { regex: /货号/, alias: '货号' },
    // Name related
    { regex: /名称|品名/, alias: '名称' },
    { regex: /物品名|商品名|产品名/, alias: '品名' },
    // Quantity related
    { regex: /数量|件数|个数|数目/, alias: '数量' },
    { regex: /出库|发货|出货/, alias: '出库' },
    { regex: /qty|quantity/i, alias: 'qty' },
    // Spec/Model related
    { regex: /规格|型号|规格型号/, alias: '规格' },
    { regex: /spec/i, alias: 'spec' },
    // External code
    { regex: /外部|配送单号|运单号|订单号|单据/, alias: '单号' },
    { regex: /code|编号/i, alias: 'code' },
    // Store
    { regex: /门店|店铺|收货门店/, alias: '门店' },
    // Recipient
    { regex: /收件人|收货人|联系人/, alias: '收件人' },
    { regex: /电话|手机|联系方式/, alias: '电话' },
    { regex: /地址/, alias: '地址' },
    // Remark
    { regex: /备注|说明|附注/, alias: '备注' },
    // Other common columns
    { regex: /单位/, alias: '单位' },
    { regex: /仓库/, alias: '仓库' },
    { regex: /序号/, alias: '序号' },
  ];
  
  for (const p of patterns) {
    if (p.regex.test(name)) {
      keywords.push(p.alias);
    }
  }
  
  return keywords;
}

// Label aliases: different label texts that map to the same system field
const FOOTER_LABEL_ALIASES: Record<string, string[]> = {
  storeName: ['收货门店', '门店', '收货机构', '店铺', '客户名称', '收货单位'],
  externalCode: ['单据号', '外部编码', '配送单号', '订单号', '运单号', '单据编号', '出库单号'],
  recipientName: ['收货人', '收件人', '联系人', '收货联系人'],
  recipientPhone: ['收货电话', '联系电话', '收件人电话', '手机', '收货手机', '联系人电话'],
  recipientAddress: ['收货地址', '收件地址', '送货地址', '详细地址', '地址'],
  remark: ['备注', '说明', '附注', '备注说明'],
};

/** 反向查找：给定一个标签文本，返回它属于哪个系统字段 */
function resolveFieldAlias(label: string): string | null {
  for (const [field, aliases] of Object.entries(FOOTER_LABEL_ALIASES)) {
    if (aliases.includes(label)) return field;
  }
  return null;
}

function extractFooterInfo(config: FooterInfoExtraction, rows: any[][]): Record<string, string> {
  const info: Record<string, string> = {};
  if (!config.enabled) return info;

  // Search ALL rows (not just last 10) — footer/header info can be anywhere
  for (const mapping of config.mappings) {
    for (const row of rows) {
      if (!row || row.length === 0) continue;

      if (config.searchPattern === 'label_value' && mapping.label) {
        const label = mapping.label.trim();

        // Strategy 1: Cell-by-cell matching (most reliable)
        // Look for a cell that IS the label, with the value in the NEXT cell
        for (let c = 0; c < row.length; c++) {
          const cellText = String(row[c] || '').trim();
          if (!cellText) continue;

          // Exact label match — value is in the next cell
          if (cellText === label || cellText === label + '：' || cellText === label + ':') {
            if (c + 1 < row.length) {
              const value = String(row[c + 1] || '').trim();
              if (value && value !== label) {
                info[mapping.field] = value;
                break;
              }
            }
          }

          // Cell starts with label + separator (like "收货人：张锦峰" in one cell)
          if (cellText.startsWith(label + '：') || cellText.startsWith(label + ':') || cellText.startsWith(label + ' ')) {
            // But ensure this isn't a LONGER label (e.g., "收货人签字" when label is "收货人")
            const charAfterLabel = cellText[label.length];
            if (charAfterLabel === '：' || charAfterLabel === ':' || charAfterLabel === ' ') {
              const value = cellText.substring(label.length + 1).trim();
              if (value) {
                info[mapping.field] = value;
                break;
              }
            }
          }
        }

        // Strategy 2: Fallback to regex on joined row string (for backward compatibility)
        if (!info[mapping.field]) {
          const rowStr = row.join(' ').trim();
          if (rowStr) {
            const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${escapedLabel}[：:\\s]+(\\S+)`, 'i');
            const match = rowStr.match(regex);
            if (match && match[1]) {
              // Verify the match isn't from a longer label
              const matchIdx = rowStr.indexOf(match[0]);
              const charBefore = matchIdx > 0 ? rowStr[matchIdx - 1] : '';
              // If there's a Chinese character right before the label, it might be a longer label — skip
              if (!charBefore || /[\s,，;；|]/.test(charBefore)) {
                info[mapping.field] = match[1].trim();
              }
            }
          }
        }
      } else if (config.searchPattern === 'regex' && mapping.regex) {
        const rowStr = row.join(' ').trim();
        if (rowStr) {
          const match = rowStr.match(new RegExp(mapping.regex));
          if (match) {
            info[mapping.field] = match[1] || match[0] || '';
          }
        }
      } else if (config.searchPattern === 'fixed_position') {
        if (mapping.rowOffset !== undefined && mapping.colOffset !== undefined) {
          const targetRow = rows[rows.length - Math.abs(mapping.rowOffset) + (mapping.rowOffset < 0 ? rows.length : 0)];
          if (targetRow && mapping.colOffset < targetRow.length) {
            info[mapping.field] = String(targetRow[mapping.colOffset] || '');
          }
        }
      }

      // Stop searching once we found a value for this mapping
      if (info[mapping.field]) break;
    }
  }

  // Phase 2: For fields that are still empty, try ALIAS labels
  // e.g., if "收货门店" didn't match, try "收货机构", "门店", etc.
  for (const mapping of config.mappings) {
    if (info[mapping.field]) continue; // already found

    const aliases = FOOTER_LABEL_ALIASES[mapping.field];
    if (!aliases) continue;

    // Try each alias (skip the one that matches the configured label)
    for (const alias of aliases) {
      if (alias === mapping.label) continue; // already tried
      if (info[mapping.field]) break;

      for (const row of rows) {
        if (!row || row.length === 0) continue;
        for (let c = 0; c < row.length; c++) {
          const cellText = String(row[c] || '').trim();
          if (!cellText) continue;

          // Exact alias match — value in next cell
          if (cellText === alias || cellText === alias + '：' || cellText === alias + ':') {
            if (c + 1 < row.length) {
              const value = String(row[c + 1] || '').trim();
              if (value && !value.includes('：') && !value.includes(':')) {
                info[mapping.field] = value;
                break;
              }
            }
          }

          // Alias + separator in same cell
          if (cellText.startsWith(alias + '：') || cellText.startsWith(alias + ':')) {
            const charAfter = cellText[alias.length];
            if (charAfter === '：' || charAfter === ':') {
              const value = cellText.substring(alias.length + 1).trim();
              if (value) {
                info[mapping.field] = value;
                break;
              }
            }
          }
        }
        if (info[mapping.field]) break;
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

/** 自动检测卡片式结构：查找"▶ 调拨记录 #N"等标志性行 */
function autoDetectCardStructure(rows: any[][]): {
  cardStartPattern: string;
  cardTableStartPattern: string;
  cardHeaderMapping: { field: string; type: string; regexPattern: string; group: number }[];
} | null {
  const cardMarkers: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const rowStr = rows[i].join(' ').trim();
    // 匹配 "▶ 调拨记录 #N" / "【记录 N】" / "卡片 #N" 等
    const match = rowStr.match(/[▶▶▸►].*?(?:记录|调拨|运单|卡片|订单).*?#?\d+/i);
    if (match) cardMarkers.push(match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  if (cardMarkers.length < 2) return null;

  // 查找卡片内表头模式（如"物品编码"）
  let tableHeaderPattern = '物品编码|物品名称';
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const rowStr = rows[i].join(' ').trim();
    if (/物品编码/.test(rowStr) && /物品名称/.test(rowStr)) {
      tableHeaderPattern = '物品编码';
      break;
    }
  }

  const uniqueMarkers = [...new Set(cardMarkers)];
  return {
    cardStartPattern: '[▶▶▸►].*?(?:记录|调拨|运单|卡片|订单)',
    cardTableStartPattern: tableHeaderPattern,
    cardHeaderMapping: [
      { field: 'storeName', type: 'regex', regexPattern: '调入门店[：:\\s]*([^\\s]+)', group: 1 },
      { field: 'recipientName', type: 'regex', regexPattern: '收货人[：:\\s]*([^\\s]+)', group: 1 },
      { field: 'recipientPhone', type: 'regex', regexPattern: '电话[：:\\s]*(\\d{11}|\\d{3}[-\\s]?\\d{8})', group: 1 },
      { field: 'recipientAddress', type: 'regex', regexPattern: '收货地址[：:\\s]*(\\S+)', group: 1 },
    ],
  };
}

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

    if (cardConfig.cardTableStartPattern) {
      for (let j = 0; j < cardRows.length; j++) {
        if (cardRows[j].join(' ').includes(cardConfig.cardTableStartPattern)) {
          tableStart = j; // header row index (0-based)
          break;
        }
      }
    } else {
      // cardTableHeaderRow is relative to card start (1-based), convert to 0-based
      tableStart = (cardConfig.cardTableHeaderRow || 3) - 1;
    }

    if (tableStart < 0 || tableStart >= cardRows.length) continue;

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

// 矩阵列头过滤：排除汇总列和元数据列（如"在库数量的总和""SKU条码"等）
const MATRIX_COL_SUMMARY_PATTERNS = [
  /总和$/, /合计$/, /小计$/, /总计$/, /结余$/, /余额$/,
  /数量.*的/, /的.*总和/, /的.*合计/,
  /在库/, /可用/, /待移入/, /分配/, /冻结/,
  /库存/, /仓库/, /货主/,
];

// 矩阵列头过滤：排除SKU元数据列（非门店名）
const MATRIX_COL_METADATA_PATTERNS = [
  /^sku(名称|条码|编码|名称)$/i,
  /^外部(商品)?编码$/,
  /^(仓库|货主|库存|规格|单位|状态|分类|品牌|产地)/,
  /名称$|^编码$|^条码$|^编号$/,
];

function isSummaryColumn(header: string): boolean {
  return MATRIX_COL_SUMMARY_PATTERNS.some(p => p.test(header));
}

function isMetadataColumn(header: string): boolean {
  return MATRIX_COL_METADATA_PATTERNS.some(p => p.test(header));
}

function parseMatrix(rule: ParseRule, rows: any[][], footerInfo: Record<string, string>, errors: string[]): OrderItem[] {
  const items: OrderItem[] = [];
  const mc = rule.matrixConfig!;
  if (!mc.enabled) return items;

  const headerRow = rows[mc.colHeaderRow - 1] || [];
  const colHeaders: { idx: number; value: string }[] = [];
  for (let c = mc.colHeaderStartCol - 1; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').trim();
    if (!val || isSummaryColumn(val) || isMetadataColumn(val)) continue;

    // 数据驱动检测：门店列的单元格值应以数字为主
    // 抽样前几行数据，如果该列大部分值不是数字则跳过
    let numericCount = 0;
    let totalChecked = 0;
    const sampleEnd = Math.min(rows.length, mc.dataStartRow - 1 + 10);
    for (let sr = mc.dataStartRow - 1; sr < sampleEnd; sr++) {
      const cellVal = String(rows[sr]?.[c] ?? '').trim();
      if (!cellVal) continue;
      totalChecked++;
      if (/^\d+(\.\d+)?$/.test(cellVal)) numericCount++;
    }
    // 短列头（≤6字）很可能是门店名，放宽要求
    const looksLikeStoreName = val.length <= 6 && val.length >= 2;
    const minRatio = looksLikeStoreName ? 0.1 : 0.5;

    if (looksLikeStoreName && totalChecked === 0) {
      // 空列但列头像门店名 → 纳入
      colHeaders.push({ idx: c, value: val });
    } else if (totalChecked > 0 && numericCount / totalChecked >= minRatio) {
      colHeaders.push({ idx: c, value: val });
    }
  }

  for (let r = mc.dataStartRow - 1; r < rows.length; r++) {
    const row = rows[r];
    const rowLabel = String(row[mc.dataStartCol - 1] || '').trim();
    if (!rowLabel) continue;

    // 提取额外的行级字段（如 skuCode, skuSpec 等）
    const rowFieldValues: Record<string, string> = {};
    if (mc.rowFields && mc.rowFields.length > 0) {
      for (const rf of mc.rowFields) {
        const colIdx = rf.col - 1; // 1-based to 0-based
        rowFieldValues[rf.field] = String(row[colIdx] || '').trim();
      }
    }

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
            // 应用行级字段
            for (const [field, value] of Object.entries(rowFieldValues)) {
              (item as any)[field] = value;
            }
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
        // 应用行级字段
        for (const [field, value] of Object.entries(rowFieldValues)) {
          (item as any)[field] = value;
        }
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

    // Required fields
    if (!item.skuCode) errors.push({ rowIndex: idx, field: 'skuCode', message: 'SKU编码不能为空' });
    if (!item.skuName) errors.push({ rowIndex: idx, field: 'skuName', message: 'SKU名称不能为空' });
    if (!item.skuQuantity || item.skuQuantity <= 0) {
      errors.push({ rowIndex: idx, field: 'skuQuantity', message: '发货数量必须为正数' });
    }

    // 门店/收件人信息：至少填写一项（门店名 或 收件人姓名 或 收件人电话）
    const hasAnyRecipient = !!(item.storeName || item.recipientName || item.recipientPhone);
    if (!hasAnyRecipient) {
      errors.push({ rowIndex: idx, field: 'storeName', message: '请填写收货门店或收件人信息' });
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
