// ===== Core Data Types =====

/** 下单运单记录（每行一个 SKU） */
export interface OrderItem {
  id?: string;
  batchId?: string;
  externalCode: string;   // 外部编码
  storeName: string;       // 收货门店
  recipientName: string;   // 收件人姓名
  recipientPhone: string;  // 收件人电话
  recipientAddress: string;// 收件人地址
  skuCode: string;         // SKU物品编码
  skuName: string;         // SKU物品名称
  skuQuantity: number;     // SKU发货数量
  skuSpec: string;         // SKU规格型号
  remark: string;          // 备注
  createdAt?: string;
  __rowIndex?: number;     // 原始行号
  __errors?: ValidationError[];
  __duplicateWith?: string; // 重复的外部编码
}

/** 校验错误 */
export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

// ===== Parse Rule Engine Types =====

export type FileSourceType = 'excel' | 'word' | 'pdf';
export type ExtractionMode = 'row' | 'matrix' | 'card' | 'text';

/** 列映射配置 */
export interface ColumnMap {
  field: string;        // 目标字段名
  sourceColumn?: string; // 源列名（row/card模式）
  sourceRow?: number;    // 源行索引（matrix/text模式）
  sourceCol?: number;    // 源列索引（matrix模式）
  type: 'direct' | 'static' | 'default' | 'composite' | 'regex';
  staticValue?: string;
  defaultValue?: string;
  regexPattern?: string;  // 正则提取模式
  regexGroup?: number;    // 正则分组索引
  compositeDelimiter?: string; // 复合单元格分隔符（如"\n"）
  compositePattern?: string;   // 复合单元格模式（如"{name}x{qty}"）
}

/** 尾部信息提取配置 */
export interface FooterInfoExtraction {
  enabled: boolean;
  searchPattern: 'label_value' | 'fixed_position' | 'regex';
  mappings: {
    field: string;
    label?: string;         // 标签文本（如"收件人："）
    rowOffset?: number;     // 相对尾部的行偏移
    colOffset?: number;     // 列偏移
    regex?: string;
    valueExtract?: string;  // 值提取方式
  }[];
}

/** 矩阵转置配置 */
export interface MatrixConfig {
  enabled: boolean;
  rowLabelField: string;    // 行标签对应的字段（如 skuName）
  colHeaderStartCol: number; // 列头起始列
  colHeaderRow: number;      // 列头所在行
  dataStartRow: number;      // 数据起始行
  dataStartCol: number;      // 行标签列
  colHeaderIsField: string;  // 列头映射到哪个字段（如 storeName）
  transposeValueField: string; // 单元格值映射到哪个字段（如 skuQuantity）
  rowFields?: { field: string; col: number }[]; // 额外的行级字段（如 [{field:'skuCode', col:4}]）
}

/** 卡片识别配置 */
export interface CardConfig {
  enabled: boolean;
  cardStartPattern: string;    // 卡片起始标志的正则（如"▶ 调拨记录 #\\d+"）
  cardEndPattern?: string;     // 卡片结束标志
  cardHeaderMapping: ColumnMap[];  // 卡片头部信息映射
  cardTableStartPattern?: string;  // 卡片内表格起始标志
  cardTableEndPattern?: string;    // 卡片内表格结束标志
  cardTableHeaderRow?: number;     // 卡片内表格表头行（相对卡片起始）
  cardTableMapping: ColumnMap[];   // 卡片内表格列映射
}

/** 文本解析配置 */
export interface TextConfig {
  enabled: boolean;
  recordSeparator: string;    // 记录分隔符（如"━━━"）
  fieldParsers: {
    field: string;
    pattern: string;          // 正则匹配模式
    group?: number;           // 正则分组
  }[];
  itemPattern: string;        // 物品行匹配模式（如"\\d+\\.\\s*(\\S+)\\s*\\|\\s*(\\S+)\\s*\\|\\s*(\\S+)\\s*\\|\\s*(\\d+)"）
  itemFieldOrder: string[];   // 物品字段顺序
}

/** 跳行条件 */
export interface SkipCondition {
  condition: 'row_empty' | 'cell_contains' | 'row_contains';
  pattern?: string;
  rowIndex?: number;
}

/** 解析规则定义 */
export interface ParseRule {
  id: string;
  name: string;
  description?: string;
  sourceType: FileSourceType;
  extractionMode: ExtractionMode;

  // 头部/尾部处理
  headerRowsToSkip: number;
  footerRowsToSkip: number;
  footerInfoExtraction?: FooterInfoExtraction;

  // 列映射
  columnMapping: Record<string, ColumnMap>;

  // 聚合配置
  groupByField?: string;      // 按哪个字段聚合（如 externalCode）

  // 高级模式配置
  matrixConfig?: MatrixConfig;
  cardConfig?: CardConfig;
  textConfig?: TextConfig;

  // 多Sheet
  multiSheetMode: 'merge' | 'first' | 'specific';
  sheetNames?: string[];

  // 复合单元格拆分
  compositeCellSplit?: {
    enabled: boolean;
    field: string;
    delimiter: string;       // "\n"
    pattern: string;         // "{name}x{qty}" - 解析模式
  };

  // 后处理
  skipConditions?: SkipCondition[];
  defaultValues: Record<string, string>;
  staticValues: Record<string, string>;

  // AI 元数据
  aiGenerated?: boolean;
  aiConfidence?: Record<string, 'high' | 'medium' | 'low'>;
  aiNotes?: string;

  createdAt: string;
  updatedAt: string;
}

/** 解析结果 */
export interface ParseResult {
  success: boolean;
  data: OrderItem[];
  errors: string[];
  ruleUsed?: string;
  stats?: {
    totalRows: number;
    parsedRows: number;
    skippedRows: number;
    errors: number;
    timeMs: number;
  };
}

/** 批量提交结果 */
export interface SubmitResult {
  success: boolean;
  total: number;
  successCount: number;
  failCount: number;
  errors: { row: number; message: string }[];
}
