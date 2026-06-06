'use client';

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import FileUploader from '@/components/FileUploader';
import RuleSelector from '@/components/RuleSelector';
import ProgressBar from '@/components/ProgressBar';
import DataTable from '@/components/DataTable';
import RuleEditor from '@/components/RuleEditor';
import type { OrderItem, ParseRule, ParseResult } from '@/lib/types';
import { validateOrderItems, findDuplicates } from '@/lib/rule-engine';
import * as XLSX from 'xlsx';

type Step = 'upload' | 'select-rule' | 'preview' | 'submitted';

export default function HomePage() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [selectedRuleConfig, setSelectedRuleConfig] = useState<ParseRule | null>(null);
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [ruleRefreshKey, setRuleRefreshKey] = useState(0);
  const [previewData, setPreviewData] = useState<any>(null); // For AI analysis
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseProgress, setParseProgress] = useState({ visible: false, progress: 0, label: '', sublabel: '' });
  const [submitProgress, setSubmitProgress] = useState({ visible: false, progress: 0, label: '', sublabel: '' });
  const [submittedBatchId, setSubmittedBatchId] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseDebug, setParseDebug] = useState<any>(null);

  // Step 1: Select file
  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    setParseErrors([]);
    setParseProgress({ visible: true, progress: 0, label: '正在预览文件...', sublabel: '' });

    try {
      const formData = new FormData();
      formData.append('file', f);
      const res = await fetch('/api/parse/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setPreviewData(data.data);
        setParseProgress({ visible: false, progress: 100, label: '', sublabel: '' });
        setStep('select-rule');
        toast.success('文件加载成功，请选择解析规则');
      } else {
        toast.error(data.error || '文件预览失败');
        setParseProgress({ visible: false, progress: 0, label: '', sublabel: '' });
      }
    } catch (e: any) {
      toast.error('文件预览失败: ' + e.message);
      setParseProgress({ visible: false, progress: 0, label: '', sublabel: '' });
    }
  }, []);

  // Step 2: Select rule and parse
  const handleRuleSelect = useCallback((ruleId: string, ruleConfig: ParseRule) => {
    setSelectedRuleId(ruleId);
    setSelectedRuleConfig(ruleConfig);
  }, []);

  const handleCreateNewRule = useCallback(() => {
    setShowRuleEditor(true);
  }, []);

  const handleParseWithRule = useCallback(async () => {
    if (!file || !selectedRuleConfig) {
      toast.error('请先选择文件和解折规则');
      return;
    }

    setParseErrors([]);
    setParseProgress({ visible: true, progress: 10, label: '正在解析文件...', sublabel: '读取文件数据' });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('rule', JSON.stringify(selectedRuleConfig));

      setParseProgress(prev => ({ ...prev, progress: 30, sublabel: '应用解析规则...' }));

      const res = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.data) {
        setParseProgress({ visible: true, progress: 80, label: '校验数据...', sublabel: '' });
        const result = data.data as ParseResult;
        
        // Capture debug info
        if (data.data.debug) {
          setParseDebug(data.data.debug);
        }
        if (data.data.firstSheetInfo) {
          console.log('Parse debug:', data.data.debug);
          console.log('First sheet:', data.data.firstSheetInfo);
        }

        // Validate
        let validated = validateOrderItems(result.data);

        // Check duplicates - 只在有外部编码时检查
        try {
          const codes = validated.map(o => o.externalCode).filter(Boolean);
          if (codes.length > 0) {
            const dupRes = await fetch('/api/orders/check-duplicates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codes }),
            });
            if (dupRes.ok) {
              const dupData = await dupRes.json();
              const existingCodes = dupData.existingCodes || [];
              if (existingCodes.length > 0) {
                validated = findDuplicates(validated, existingCodes);
              }
            }
          }
        } catch {}

        setOrders(validated);
        setParseResult(result);
        setStep('preview');
        setParseProgress({ visible: false, progress: 100, label: '', sublabel: '' });

        const errorCount = validated.reduce((s, o) => s + (o.__errors?.length || 0), 0);
        if (errorCount > 0) {
          toast(`解析完成，共 ${validated.length} 条，${errorCount} 条有校验错误`, { icon: '⚠️' });
        } else {
          toast.success(`解析完成，共 ${validated.length} 条记录`);
        }
      } else {
        setParseErrors(data.errors || [data.error || '解析失败']);
        setParseProgress({ visible: false, progress: 0, label: '', sublabel: '' });
        toast.error(data.error || '解析失败');
      }
    } catch (e: any) {
      setParseErrors([e.message]);
      setParseProgress({ visible: false, progress: 0, label: '', sublabel: '' });
      toast.error('解析失败: ' + e.message);
    }
  }, [file, selectedRuleConfig]);

  // Step 3: Edit data
  const handleDataChange = useCallback((newData: OrderItem[]) => {
    const validated = validateOrderItems(newData);
    setOrders(validated);
  }, []);

  const handleDeleteRow = useCallback((index: number) => {
    setOrders(prev => {
      const newData = prev.filter((_, i) => i !== index);
      return validateOrderItems(newData);
    });
    toast.success('已删除行');
  }, []);

  const handleAddRow = useCallback(() => {
    setOrders(prev => {
      const newRow: OrderItem = {
        externalCode: '',
        storeName: '',
        recipientName: '',
        recipientPhone: '',
        recipientAddress: '',
        skuCode: '',
        skuName: '',
        skuQuantity: 1,
        skuSpec: '',
        remark: '',
        __rowIndex: prev.length,
      };
      return [...prev, newRow];
    });
    toast.success('已添加空行');
  }, []);

  // Step 4: Submit
  const handleSubmit = useCallback(async () => {
    const hasErrors = orders.some(o => (o.__errors?.length || 0) > 0);
    if (hasErrors) {
      toast.error('存在校验不通过的数据，请先修正红色标记的行');
      return;
    }

    setSubmitProgress({ visible: true, progress: 0, label: '正在提交...', sublabel: '' });

    try {
      setSubmitProgress(prev => ({ ...prev, progress: 30, sublabel: '校验数据完整性...' }));
      const res = await fetch('/api/orders/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();

      setSubmitProgress(prev => ({ ...prev, progress: 80, sublabel: '写入数据库...' }));

      if (data.success) {
        setSubmittedBatchId(data.data.batchId);
        setStep('submitted');
        setSubmitProgress({ visible: false, progress: 100, label: '', sublabel: '' });
        toast.success(`提交成功！共 ${data.data.total} 条，成功 ${data.data.successCount} 条`);
      } else {
        setSubmitProgress({ visible: false, progress: 0, label: '', sublabel: '' });
        toast.error(data.error || '提交失败');
      }
    } catch (e: any) {
      setSubmitProgress({ visible: false, progress: 0, label: '', sublabel: '' });
      toast.error('提交失败: ' + e.message);
    }
  }, [orders]);

  // Export to Excel
  const handleExport = useCallback(() => {
    const wsData = [
      ['外部编码', '收货门店', '收件人姓名', '收件人电话', '收件人地址', 'SKU编码', 'SKU名称', '发货数量', '规格型号', '备注'],
      ...orders.map(o => [
        o.externalCode, o.storeName, o.recipientName, o.recipientPhone,
        o.recipientAddress, o.skuCode, o.skuName, o.skuQuantity, o.skuSpec, o.remark,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '运单数据');
    XLSX.writeFile(wb, `运单数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('导出成功');
  }, [orders]);

  // Reset
  const handleReset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setSelectedRuleId(null);
    setOrders([]);
    setParseResult(null);
    setParseErrors([]);
    setSubmittedBatchId(null);
  }, []);

  const handleRuleSaved = useCallback((rule: ParseRule & { id: string; name: string }) => {
    setShowRuleEditor(false);
    setRuleRefreshKey(k => k + 1);
    setSelectedRuleId(rule.id);
    setSelectedRuleConfig(rule);
    toast.success('规则已保存');
  }, []);

  // Render
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">导入下单</h1>
        <p className="text-sm text-gray-400 mt-1">上传出库单文件，智能解析并批量下单</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'select-rule', 'preview', 'submitted'] as Step[]).map((s, i) => {
          const isDone = (step === 'submitted' && i <= 3) || (step !== 'upload' && i < (s === 'submitted' ? 3 : ['upload', 'select-rule', 'preview', 'submitted'].indexOf(step)));
          const isCurrent = step === s;
          const labels = { upload: '1. 上传文件', 'select-rule': '2. 选择规则', preview: '3. 预览编辑', submitted: '4. 提交完成' };
          return (
            <div key={s} className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                isDone ? 'bg-primary text-white' :
                isCurrent ? 'bg-primary-light text-primary-deep ring-1 ring-primary' :
                'bg-gray-100 text-gray-400'
              }`}>
                {labels[s]}
              </span>
              {i < 3 && <span className="text-gray-300">→</span>}
            </div>
          );
        })}
      </div>

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="card">
          <FileUploader onFileSelect={handleFileSelect} disabled={parseProgress.visible} />
          <ProgressBar {...parseProgress} />
        </div>
      )}

      {/* Rule Selection Step */}
      {step === 'select-rule' && file && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <RuleSelector
              selectedRuleId={selectedRuleId}
              onSelect={handleRuleSelect}
              onCreateNew={handleCreateNewRule}
              currentFileType={previewData?.fileType || null}
              refreshTrigger={ruleRefreshKey}
            />
          </div>
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-800">已选文件</h3>
                <button onClick={handleReset} className="text-sm text-gray-400 hover:text-gray-600">
                  重新选择
                </button>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-2xl">📄</span>
                <div>
                  <p className="text-sm font-medium text-gray-700">{file.name}</p>
                  <p className="text-xs text-gray-400">
                    {(file.size / 1024).toFixed(1)} KB
                    {previewData?.sheets && ` · ${previewData.sheets.length} 个数据表`}
                  </p>
                </div>
              </div>

              <button
                onClick={handleParseWithRule}
                disabled={!selectedRuleId}
                className="btn-primary w-full mt-4"
              >
                执行解析
              </button>

              <ProgressBar {...parseProgress} />
            </div>

            {parseErrors.length > 0 && (
              <div className="card !border-red-200 !bg-red-50">
                <h4 className="text-sm font-semibold text-red-600 mb-2">解析错误</h4>
                <ul className="text-xs text-red-500 space-y-1">
                  {parseErrors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {parseDebug && (
              <div className="card !border-gray-200 !bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-600 mb-2">解析调试信息</h4>
                <pre className="text-[10px] text-gray-500 overflow-auto max-h-40 whitespace-pre-wrap">
                  {JSON.stringify(parseDebug, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview & Edit Step */}
      {step === 'preview' && (
        <div className="space-y-4">
          {parseResult?.stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '总行数', value: parseResult.stats.totalRows },
                { label: '解析成功', value: parseResult.stats.parsedRows },
                { label: '解析错误', value: parseResult.stats.errors, warn: parseResult.stats.errors > 0 },
                { label: '耗时', value: `${(parseResult.stats.timeMs / 1000).toFixed(2)}s` },
              ].map(stat => (
                <div key={stat.label} className={`card !py-3 !px-4 ${stat.warn ? '!border-red-200 !bg-red-50' : ''}`}>
                  <div className="text-xs text-gray-400">{stat.label}</div>
                  <div className={`text-xl font-bold ${stat.warn ? 'text-red-500' : 'text-gray-800'}`}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <DataTable
              data={orders}
              onDataChange={handleDataChange}
              onDeleteRow={handleDeleteRow}
              onAddRow={handleAddRow}
            />
          </div>

          <div className="flex items-center gap-3 justify-end">
            <button onClick={handleExport} className="btn-secondary">
              导出Excel
            </button>
            <button onClick={handleReset} className="btn-secondary">
              重新导入
            </button>
            <button onClick={handleSubmit} className="btn-primary" disabled={submitProgress.visible}>
              提交下单
            </button>
          </div>

          <ProgressBar {...submitProgress} />
        </div>
      )}

      {/* Submitted Step */}
      {step === 'submitted' && (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">提交成功！</h2>
          <p className="text-gray-500 mb-1">批次号: {submittedBatchId}</p>
          <p className="text-sm text-gray-400">共提交 {orders.length} 条运单记录</p>
          <div className="mt-6 space-x-3">
            <button onClick={handleReset} className="btn-primary">
              继续导入
            </button>
            <a href="/orders" className="btn-secondary inline-block">
              查看已导入运单
            </a>
          </div>
        </div>
      )}

      {/* Rule Editor Modal */}
      {showRuleEditor && (
        <RuleEditor
          fileName={file?.name || ''}
          fileType={previewData?.fileType || 'excel'}
          previewData={previewData}
          onSave={handleRuleSaved}
          onCancel={() => setShowRuleEditor(false)}
        />
      )}
    </div>
  );
}
