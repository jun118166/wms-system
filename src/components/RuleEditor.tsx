'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ParseRule, FileSourceType, ExtractionMode, ColumnMap, FooterInfoExtraction, MatrixConfig, CardConfig, TextConfig } from '@/lib/types';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

interface RuleEditorProps {
  fileName: string;
  fileType: FileSourceType;
  previewData: any;
  initialRule?: ParseRule & { id: string; name: string; description?: string };
  onSave: (rule: ParseRule & { id: string; name: string }) => void;
  onCancel: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  externalCode: '外部编码',
  storeName: '收货门店',
  recipientName: '收件人姓名',
  recipientPhone: '收件人电话',
  recipientAddress: '收件人地址',
  skuCode: 'SKU编码',
  skuName: 'SKU名称',
  skuQuantity: '发货数量',
  skuSpec: '规格型号',
  remark: '备注',
};

export default function RuleEditor({ fileName, fileType, previewData, initialRule, onSave, onCancel }: RuleEditorProps) {
  const [name, setName] = useState(initialRule?.name || '');
  const [description, setDescription] = useState(initialRule?.description || '');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(initialRule?.extractionMode || 'row');
  const [headerRowsToSkip, setHeaderRowsToSkip] = useState(initialRule?.headerRowsToSkip || 0);
  const [footerRowsToSkip, setFooterRowsToSkip] = useState(initialRule?.footerRowsToSkip || 0);
  const [groupByField, setGroupByField] = useState(initialRule?.groupByField || '');
  const [multiSheetMode, setMultiSheetMode] = useState<'merge' | 'first' | 'specific'>(initialRule?.multiSheetMode || 'merge');
  const [columnMapping, setColumnMapping] = useState<Record<string, ColumnMap>>(initialRule?.columnMapping || {});
  const [defaultValues, setDefaultValues] = useState<Record<string, string>>(initialRule?.defaultValues || {});
  const [staticValues, setStaticValues] = useState<Record<string, string>>(initialRule?.staticValues || {});
  const [skipPatterns, setSkipPatterns] = useState<string[]>(
    initialRule?.skipConditions?.map(c => c.pattern || '').filter(Boolean) || []
  );

  // Footer extraction
  const [footerEnabled, setFooterEnabled] = useState(initialRule?.footerInfoExtraction?.enabled || false);
  const [footerMappings, setFooterMappings] = useState<{ field: string; label: string }[]>(
    initialRule?.footerInfoExtraction?.mappings?.map(m => ({ field: m.field, label: m.label || '' })) || []
  );

  // Matrix config
  const [matrixEnabled, setMatrixEnabled] = useState(initialRule?.matrixConfig?.enabled || false);
  const [matrixConfig, setMatrixConfig] = useState<Partial<MatrixConfig>>(initialRule?.matrixConfig || {});

  // Composite cell
  const [compositeEnabled, setCompositeEnabled] = useState(initialRule?.compositeCellSplit?.enabled || false);

  // AI generation
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'basic' | 'mapping' | 'advanced'>('basic');

  const handleAiGenerate = useCallback(async () => {
    if (!previewData) {
      toast.error('请先上传文件以进行AI分析');
      return;
    }
    setAiGenerating(true);
    toast.loading('AI正在分析文件结构...', { id: 'ai-gen' });

    try {
      const res = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          fileType,
          previewData: {
            sheets: previewData.sheets || [],
            rawText: previewData.rawText,
          },
        }),
      });
      const data = await res.json();

      if (data.success && data.data) {
        const result = data.data;
        setAiResult(result);
        const rule = result.rule;

        // Populate form with AI result
        if (rule.name) setName(rule.name);
        if (rule.description) setDescription(rule.description);
        if (rule.extractionMode) setExtractionMode(rule.extractionMode);
        if (rule.headerRowsToSkip !== undefined) setHeaderRowsToSkip(rule.headerRowsToSkip);
        if (rule.footerRowsToSkip !== undefined) setFooterRowsToSkip(rule.footerRowsToSkip);
        if (rule.groupByField) setGroupByField(rule.groupByField);
        if (rule.multiSheetMode) setMultiSheetMode(rule.multiSheetMode);
        if (rule.columnMapping) {
          // Normalize: convert array to object if AI returns array format
          const cm = Array.isArray(rule.columnMapping)
            ? Object.fromEntries(rule.columnMapping.map((m: any) => [m.field || '', m]))
            : rule.columnMapping;
          setColumnMapping(cm);
        }
        if (rule.defaultValues) setDefaultValues(rule.defaultValues);
        if (rule.staticValues) setStaticValues(rule.staticValues);
        if (rule.footerInfoExtraction) {
          setFooterEnabled(rule.footerInfoExtraction.enabled || false);
          setFooterMappings(rule.footerInfoExtraction.mappings?.map((m: any) => ({ field: m.field, label: m.label || '' })) || []);
        }
        if (rule.matrixConfig) {
          setMatrixEnabled(rule.matrixConfig.enabled || false);
          setMatrixConfig(rule.matrixConfig);
        }
        if (rule.compositeCellSplit) {
          setCompositeEnabled(rule.compositeCellSplit.enabled || false);
        }

        toast.success('AI规则生成完成，请确认并微调', { id: 'ai-gen' });
      } else {
        toast.error(data.error || 'AI生成失败', { id: 'ai-gen' });
      }
    } catch (e: any) {
      toast.error('AI生成失败: ' + e.message, { id: 'ai-gen' });
    } finally {
      setAiGenerating(false);
    }
  }, [previewData, fileName, fileType]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error('请输入规则名称');
      return;
    }

    const ruleId = initialRule?.id || uuidv4();

    const config: ParseRule = {
      id: ruleId,
      name: name.trim(),
      description: description.trim(),
      sourceType: fileType,
      extractionMode,
      headerRowsToSkip,
      footerRowsToSkip,
      footerInfoExtraction: footerEnabled ? {
        enabled: true,
        searchPattern: 'label_value',
        mappings: footerMappings.map(m => ({ field: m.field, label: m.label })),
      } : undefined,
      columnMapping,
      groupByField: groupByField || undefined,
      matrixConfig: matrixEnabled ? {
        enabled: true,
        rowLabelField: matrixConfig.rowLabelField || 'skuName',
        colHeaderStartCol: matrixConfig.colHeaderStartCol || 1,
        colHeaderRow: matrixConfig.colHeaderRow || 1,
        dataStartRow: matrixConfig.dataStartRow || 2,
        dataStartCol: matrixConfig.dataStartCol || 1,
        colHeaderIsField: matrixConfig.colHeaderIsField || 'storeName',
        transposeValueField: matrixConfig.transposeValueField || 'skuQuantity',
      } : undefined,
      cardConfig: undefined,
      textConfig: undefined,
      multiSheetMode,
      compositeCellSplit: compositeEnabled ? {
        enabled: true,
        field: 'skuQuantity',
        delimiter: '\\n',
        pattern: '{name}x{qty}',
      } : undefined,
      skipConditions: skipPatterns.filter(Boolean).map(p => ({
        condition: 'row_contains' as const,
        pattern: p,
      })),
      defaultValues,
      staticValues,
      aiGenerated: !!aiResult,
      aiConfidence: aiResult?.confidence,
      aiNotes: aiResult?.analysis,
      createdAt: initialRule?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const method = initialRule ? 'PUT' : 'POST';
      const url = initialRule ? `/api/rules/${ruleId}` : '/api/rules';

      // Add id for new rule creation
      const body = initialRule
        ? { name: config.name, description: config.description, config }
        : { id: ruleId, name: config.name, description: config.description, config };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        onSave({ ...config, id: ruleId, name: config.name });
      } else {
        // Save locally if DB is not available
        onSave({ ...config, id: ruleId, name: config.name });
      }
    } catch {
      // Fallback: save locally
      onSave({ ...config, id: ruleId, name: config.name });
    }
  }, [name, description, extractionMode, headerRowsToSkip, footerRowsToSkip, groupByField, multiSheetMode, columnMapping, defaultValues, staticValues, skipPatterns, footerEnabled, footerMappings, matrixEnabled, matrixConfig, compositeEnabled, fileType, initialRule, aiResult, onSave]);

  const addColumnMapping = useCallback(() => {
    const unused = Object.keys(FIELD_LABELS).find(k => !columnMapping[k]);
    if (unused) {
      setColumnMapping(prev => ({
        ...prev,
        [unused]: { field: unused, sourceColumn: '', type: 'direct' },
      }));
    }
  }, [columnMapping]);

  const updateColumnMapping = useCallback((field: string, updates: Partial<ColumnMap>) => {
    setColumnMapping(prev => ({
      ...prev,
      [field]: { ...prev[field], ...updates },
    }));
  }, []);

  const removeColumnMapping = useCallback((field: string) => {
    setColumnMapping(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-800">
              {initialRule ? '编辑解析规则' : '新建解析规则'}
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              文件: {fileName} · 类型: {fileType}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5">
          {[
            { id: 'basic' as const, label: '基本设置' },
            { id: 'mapping' as const, label: '字段映射' },
            { id: 'advanced' as const, label: '高级配置' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* AI Generate Button */}
          <div className="bg-primary-light rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary-deep">AI 智能分析</p>
              <p className="text-xs text-primary-deep/60 mt-0.5">
                让AI分析文件结构并自动生成解析规则
              </p>
            </div>
            <button
              onClick={handleAiGenerate}
              disabled={aiGenerating}
              className="btn-primary text-sm"
            >
              {aiGenerating ? (
                <span className="flex items-center gap-2">
                  <svg className="spinner w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                  </svg>
                  分析中...
                </span>
              ) : '🤖 AI 生成规则'}
            </button>
          </div>

          {aiResult && (
            <div className="bg-green-50 rounded-xl p-4 text-sm">
              <p className="font-medium text-green-700 mb-1">AI 分析结果</p>
              <p className="text-green-600 text-xs">{aiResult.analysis}</p>
              {aiResult.confidence && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(aiResult.confidence).map(([field, conf]) => (
                    <span
                      key={field}
                      className={`badge text-xs ${
                        conf === 'high' ? 'badge-success' :
                        conf === 'medium' ? 'badge-warning' : 'badge-error'
                      }`}
                    >
                      {FIELD_LABELS[field] || field}: {conf === 'high' ? '高' : conf === 'medium' ? '中' : '低'}置信度
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Basic Settings */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">规则名称 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例：湖南仓发货单解析规则"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">规则说明</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="描述该规则适用的场景和文件特征..."
                  className="input-field h-20 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">提取模式</label>
                  <select
                    value={extractionMode}
                    onChange={e => setExtractionMode(e.target.value as ExtractionMode)}
                    className="input-field"
                  >
                    <option value="row">行式提取 (标准表格)</option>
                    <option value="matrix">矩阵转置 (SKU×门店矩阵)</option>
                    <option value="card">卡片式提取 (独立记录区)</option>
                    <option value="text">文本解析 (纯文本/Word)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">多Sheet模式</label>
                  <select
                    value={multiSheetMode}
                    onChange={e => setMultiSheetMode(e.target.value as any)}
                    className="input-field"
                  >
                    <option value="merge">合并所有Sheet</option>
                    <option value="first">仅第一个Sheet</option>
                    <option value="specific">指定Sheet</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">头部跳过行数</label>
                  <input
                    type="number"
                    min={0}
                    value={headerRowsToSkip}
                    onChange={e => setHeaderRowsToSkip(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">尾部跳过行数</label>
                  <input
                    type="number"
                    min={0}
                    value={footerRowsToSkip}
                    onChange={e => setFooterRowsToSkip(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">聚合字段</label>
                <select
                  value={groupByField}
                  onChange={e => setGroupByField(e.target.value)}
                  className="input-field"
                >
                  <option value="">不聚合</option>
                  <option value="externalCode">按外部编码聚合</option>
                  <option value="storeName">按门店聚合</option>
                </select>
              </div>
            </div>
          )}

          {/* Field Mapping */}
          {activeTab === 'mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">列映射配置</p>
                <button onClick={addColumnMapping} className="btn-secondary text-xs">
                  + 添加映射
                </button>
              </div>

              <div className="space-y-2">
                {Object.entries(columnMapping).map(([field, map]) => (
                  <div key={field} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium text-gray-700 w-24 shrink-0">
                      {FIELD_LABELS[field] || field}
                    </span>
                    <select
                      value={map.type}
                      onChange={e => updateColumnMapping(field, { type: e.target.value as ColumnMap['type'] })}
                      className="input-field w-24 shrink-0"
                    >
                      <option value="direct">直接映射</option>
                      <option value="static">静态值</option>
                      <option value="default">默认值</option>
                      <option value="regex">正则提取</option>
                    </select>
                    {map.type === 'direct' && (
                      <input
                        type="text"
                        value={map.sourceColumn || ''}
                        onChange={e => updateColumnMapping(field, { sourceColumn: e.target.value })}
                        placeholder="源列名/列索引"
                        className="input-field flex-1"
                      />
                    )}
                    {map.type === 'static' && (
                      <input
                        type="text"
                        value={map.staticValue || ''}
                        onChange={e => updateColumnMapping(field, { staticValue: e.target.value })}
                        placeholder="固定值"
                        className="input-field flex-1"
                      />
                    )}
                    {map.type === 'default' && (
                      <input
                        type="text"
                        value={map.defaultValue || ''}
                        onChange={e => updateColumnMapping(field, { defaultValue: e.target.value })}
                        placeholder="默认值"
                        className="input-field flex-1"
                      />
                    )}
                    {map.type === 'regex' && (
                      <input
                        type="text"
                        value={map.regexPattern || ''}
                        onChange={e => updateColumnMapping(field, { regexPattern: e.target.value })}
                        placeholder="正则表达式"
                        className="input-field flex-1"
                      />
                    )}
                    <button
                      onClick={() => removeColumnMapping(field)}
                      className="text-red-400 hover:text-red-600 text-sm px-2"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {Object.keys(columnMapping).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">
                  暂无映射，请点击"+ 添加映射"或使用 AI 生成规则自动填充
                </p>
              )}
            </div>
          )}

          {/* Advanced Settings */}
          {activeTab === 'advanced' && (
            <div className="space-y-6">
              {/* Footer Info Extraction */}
              <div className="border rounded-xl p-4">
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={footerEnabled}
                    onChange={e => setFooterEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium text-gray-700">尾部信息提取</span>
                  <span className="text-xs text-gray-400">（收货人信息在表格外部时启用）</span>
                </label>
                {footerEnabled && (
                  <div className="space-y-2 mt-3">
                    {footerMappings.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={m.field}
                          onChange={e => {
                            const updated = [...footerMappings];
                            updated[i] = { ...updated[i], field: e.target.value };
                            setFooterMappings(updated);
                          }}
                          className="input-field w-32"
                        >
                          {Object.keys(FIELD_LABELS).map(f => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={m.label}
                          onChange={e => {
                            const updated = [...footerMappings];
                            updated[i] = { ...updated[i], label: e.target.value };
                            setFooterMappings(updated);
                          }}
                          placeholder="尾部标签文本 (如: 收件人)"
                          className="input-field flex-1"
                        />
                        <button
                          onClick={() => setFooterMappings(prev => prev.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setFooterMappings(prev => [...prev, { field: 'recipientName', label: '' }])}
                      className="text-xs text-primary hover:text-primary-dark"
                    >
                      + 添加尾部映射
                    </button>
                  </div>
                )}
              </div>

              {/* Matrix Config */}
              <div className="border rounded-xl p-4">
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={matrixEnabled}
                    onChange={e => setMatrixEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium text-gray-700">矩阵转置</span>
                  <span className="text-xs text-gray-400">（门店/日期作为列头横向排列）</span>
                </label>
                {matrixEnabled && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="text-xs text-gray-500">行标签字段</label>
                      <input
                        type="text"
                        value={matrixConfig.rowLabelField || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, rowLabelField: e.target.value }))}
                        placeholder="skuName"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">列头映射字段</label>
                      <input
                        type="text"
                        value={matrixConfig.colHeaderIsField || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, colHeaderIsField: e.target.value }))}
                        placeholder="storeName"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">列头起始列</label>
                      <input
                        type="number"
                        value={matrixConfig.colHeaderStartCol || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, colHeaderStartCol: Number(e.target.value) }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">列头所在行</label>
                      <input
                        type="number"
                        value={matrixConfig.colHeaderRow || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, colHeaderRow: Number(e.target.value) }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">数据起始行</label>
                      <input
                        type="number"
                        value={matrixConfig.dataStartRow || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, dataStartRow: Number(e.target.value) }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">行标签起始列</label>
                      <input
                        type="number"
                        value={matrixConfig.dataStartCol || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, dataStartCol: Number(e.target.value) }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">值映射字段</label>
                      <input
                        type="text"
                        value={matrixConfig.transposeValueField || ''}
                        onChange={e => setMatrixConfig(prev => ({ ...prev, transposeValueField: e.target.value }))}
                        placeholder="skuQuantity"
                        className="input-field"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Composite Cell */}
              <div className="border rounded-xl p-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={compositeEnabled}
                    onChange={e => setCompositeEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium text-gray-700">复合单元格拆分</span>
                  <span className="text-xs text-gray-400">（如"物品A×3\n物品B×5"）</span>
                </label>
              </div>

              {/* Skip Patterns */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">跳行条件</label>
                <div className="space-y-1.5">
                  {skipPatterns.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={p}
                        onChange={e => {
                          const updated = [...skipPatterns];
                          updated[i] = e.target.value;
                          setSkipPatterns(updated);
                        }}
                        placeholder="匹配文字 (如: 合计, 小计)"
                        className="input-field flex-1"
                      />
                      <button
                        onClick={() => setSkipPatterns(prev => prev.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 text-sm px-2"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setSkipPatterns(prev => [...prev, ''])}
                  className="text-xs text-primary hover:text-primary-dark mt-2"
                >
                  + 添加跳行条件
                </button>
              </div>

              {/* Default/Static Values */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">默认值</label>
                  {Object.entries(FIELD_LABELS).slice(0, 5).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-400 w-20">{label}</span>
                      <input
                        type="text"
                        value={defaultValues[key] || ''}
                        onChange={e => setDefaultValues(prev => ({ ...prev, [key]: e.target.value }))}
                        className="input-field"
                        placeholder="默认值"
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">静态值 (覆盖)</label>
                  {Object.entries(FIELD_LABELS).slice(5).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-400 w-20">{label}</span>
                      <input
                        type="text"
                        value={staticValues[key] || ''}
                        onChange={e => setStaticValues(prev => ({ ...prev, [key]: e.target.value }))}
                        className="input-field"
                        placeholder="静态值"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-5 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            {aiResult?.confidence && (
              <span>AI 辅助生成 · 部分字段为推测值，请确认</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="btn-secondary">取消</button>
            <button onClick={handleSave} className="btn-primary">保存规则</button>
          </div>
        </div>
      </div>
    </div>
  );
}
