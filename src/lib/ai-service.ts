import type { ParseRule } from './types';

// ===== AI Service for Rule Generation =====

const AI_API_URL = process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

export interface AiGenerateRequest {
  fileName: string;
  fileType: 'excel' | 'word' | 'pdf';
  previewData: {
    sheets: { name: string; previewRows: any[][] }[];
    rawText?: string;
  };
}

export interface AiGenerateResponse {
  rule: Partial<ParseRule>;
  analysis: string;
  confidence: Record<string, 'high' | 'medium' | 'low'>;
}

/** 调用大模型分析文件结构并生成解析规则 */
export async function generateRuleFromAI(request: AiGenerateRequest): Promise<AiGenerateResponse> {
  if (!AI_API_KEY) {
    throw new Error('AI API Key 未配置，请在环境变量中设置 AI_API_KEY');
  }

  const systemPrompt = `你是一个WMS仓库管理系统的智能解析助手。你的任务是分析上传的出库单文件结构，并生成一套通用的解析规则配置（JSON格式）。

重要原则：
1. 不要直接解析数据，而是生成"解析规则"——告诉系统如何解析这类文件
2. 规则应该是通用的、可复用的，不能硬编码特定文件名或特定数据值
3. 需要分析文件的结构特征（头部、数据区、尾部、表格结构等）

解析规则JSON结构如下：
{
  "name": "规则名称",
  "sourceType": "excel|word|pdf",
  "extractionMode": "row|matrix|card|text",
  
  // 头部跳过行数
  "headerRowsToSkip": number,
  // 尾部跳过行数  
  "footerRowsToSkip": number,
  
  // 尾部信息提取（如果收货人信息在文件尾部）
  "footerInfoExtraction": {
    "enabled": boolean,
    "searchPattern": "label_value|fixed_position|regex",
    "mappings": [
      { "field": "storeName|recipientName|recipientPhone|recipientAddress", "label": "标签文本", "regex": "提取正则" }
    ]
  },
  
  // 列映射（核心）：将文件列映射到系统字段
  "columnMapping": {
    "externalCode": { "field": "externalCode", "sourceColumn": "外部编码", "type": "direct", "defaultValue": "" },
    "storeName": { "field": "storeName", "sourceColumn": "收货门店", "type": "direct" },
    ... 其他字段映射
  },
  
  // 按外部编码分组聚合
  "groupByField": "externalCode|storeName|null",
  
  // 矩阵转置（如果数据是SKU×门店矩阵）
  "matrixConfig": {
    "enabled": boolean,
    "rowLabelField": "skuName",
    "colHeaderStartCol": number,
    "colHeaderRow": number,
    "dataStartRow": number,
    "dataStartCol": number,
    "colHeaderIsField": "storeName",
    "transposeValueField": "skuQuantity"
  },
  
  // 卡片识别（非标准表格，每条记录独立区域）
  "cardConfig": {
    "enabled": boolean,
    "cardStartPattern": "正则匹配卡片起始",
    "cardHeaderMapping": [...],
    "cardTableMapping": [...]
  },
  
  // 文本解析（Word等纯文本）
  "textConfig": {
    "enabled": boolean,
    "recordSeparator": "━━━",
    "fieldParsers": [...],
    "itemPattern": "...",
    "itemFieldOrder": [...]
  },
  
  // 多Sheet处理
  "multiSheetMode": "merge|first|specific",
  "sheetNames": [],
  
  // 复合单元格拆分
  "compositeCellSplit": {
    "enabled": boolean,
    "field": "skuQuantity",
    "delimiter": "\\n",
    "pattern": "{name}x{qty}"
  },
  
  // 跳行条件
  "skipConditions": [
    { "condition": "row_contains", "pattern": "合计" }
  ],
  
  // 默认值和静态值
  "defaultValues": {},
  "staticValues": {},
  
  "description": "规则说明"
}

请分析以下文件预览数据，输出JSON格式的解析规则，以及你的分析说明和每个字段映射的置信度。`;

  const contentStr = JSON.stringify({
    fileName: request.fileName,
    fileType: request.fileType,
    sheetPreviews: request.previewData.sheets.map(s => ({
      name: s.name,
      rowCount: s.previewRows.length,
      previewRows: s.previewRows.slice(0, 30), // Send first 30 rows for analysis
    })),
    textPreview: request.previewData.rawText?.substring(0, 3000),
  });

  const userPrompt = `请分析以下文件数据，生成解析规则：

文件信息：
- 文件名: ${request.fileName}
- 文件类型: ${request.fileType}

数据预览：
${contentStr}

请返回JSON格式的解析规则配置。只返回JSON，不要包含其他说明文字。格式如下：
{
  "rule": { ...规则配置... },
  "analysis": "分析说明文本",
  "confidence": { "externalCode": "high", "skuName": "high", ... }
}`;

  const response = await fetch(AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI API调用失败: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI返回内容为空');
  }

  // Parse JSON from response (may contain markdown code blocks)
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.substring(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.substring(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.substring(0, jsonStr.length - 3);
  }
  jsonStr = jsonStr.trim();

  try {
    const result = JSON.parse(jsonStr);
    return {
      rule: result.rule || result,
      analysis: result.analysis || '',
      confidence: result.confidence || {},
    };
  } catch (e) {
    throw new Error(`AI返回的JSON解析失败: ${e}\n原始内容: ${jsonStr.substring(0, 500)}`);
  }
}

/** 检查 AI API 连接状态 */
export async function checkAiConnection(): Promise<{ connected: boolean; model: string }> {
  if (!AI_API_KEY) {
    return { connected: false, model: '未配置 API Key' };
  }
  try {
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 10,
      }),
    });
    return { connected: response.ok, model: AI_MODEL };
  } catch {
    return { connected: false, model: AI_MODEL };
  }
}
