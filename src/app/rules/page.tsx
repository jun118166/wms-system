'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import type { ParseRule } from '@/lib/types';
import RuleEditor from '@/components/RuleEditor';

export default function RulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<ParseRule & { id: string; name: string; description?: string } | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      if (data.success) {
        const mapped = data.data.map((r: any) => ({
          ...r,
          extractionMode: r.config?.extractionMode || 'row',
          sourceType: r.config?.sourceType || 'excel',
          aiGenerated: r.config?.aiGenerated,
          headerRowsToSkip: r.config?.headerRowsToSkip,
          footerRowsToSkip: r.config?.footerRowsToSkip,
          mappingCount: Object.keys(r.config?.columnMapping || {}).length,
        }));
        setRules(mapped);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除该规则？')) return;
    try {
      const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('规则已删除');
        loadRules();
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  }, [loadRules]);

  const handleEdit = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/rules/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        const rule = data.data;
        setEditingRule({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          ...(rule.config || {}),
        });
        setShowRuleEditor(true);
      } else {
        toast.error('加载规则失败');
      }
    } catch {
      toast.error('加载规则失败');
    }
  }, []);

  const handleRuleSaved = useCallback((rule: ParseRule & { id: string; name: string }) => {
    setShowRuleEditor(false);
    setEditingRule(null);
    toast.success('规则已保存');
    loadRules();
  }, [loadRules]);

  const activeCount = rules.length;
  const aiCount = rules.filter(r => r.aiGenerated).length;

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">解析规则管理</h1>
          <p className="text-sm text-gray-400 mt-1">管理所有解析规则，支持创建、编辑、复制</p>
        </div>
        <a href="/" className="btn-primary">
          + 新建规则
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card !py-4">
          <div className="text-xs text-gray-400">规则总数</div>
          <div className="text-2xl font-bold text-gray-800">{activeCount}</div>
        </div>
        <div className="card !py-4">
          <div className="text-xs text-gray-400">AI 生成规则</div>
          <div className="text-2xl font-bold text-primary">{aiCount}</div>
        </div>
        <div className="card !py-4">
          <div className="text-xs text-gray-400">手动配置规则</div>
          <div className="text-2xl font-bold text-gray-800">{activeCount - aiCount}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">加载中...</div>
      ) : rules.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-4">⚙️</div>
          <p className="text-base text-gray-500 font-medium">暂无解析规则</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">上传文件后，可使用 AI 自动生成解析规则，或手动配置</p>
          <a href="/" className="btn-primary inline-block">开始使用</a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map(rule => (
            <div key={rule.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-800 truncate">{rule.name}</h3>
                  {rule.description && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{rule.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  {rule.aiGenerated && <span className="badge badge-info">AI</span>}
                  <span className={`badge ${
                    rule.sourceType === 'excel' ? 'badge-success' :
                    rule.sourceType === 'word' ? 'badge-warning' : 'badge-info'
                  }`}>
                    {rule.sourceType}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                <span>模式: {rule.extractionMode}</span>
                <span>跳过头: {rule.headerRowsToSkip || 0}行</span>
                <span>跳过尾: {rule.footerRowsToSkip || 0}行</span>
                <span>映射: {rule.mappingCount || 0}个字段</span>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t">
                <button
                  onClick={() => handleEdit(rule.id)}
                  className="text-xs text-primary hover:text-primary-dark font-medium"
                >
                  编辑
                </button>
                <span className="text-gray-200">|</span>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  删除
                </button>
                <span className="text-gray-200">|</span>
                <span className="text-xs text-gray-300">
                  {new Date(rule.updated_at || rule.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {showRuleEditor && (
      <RuleEditor
        fileName={editingRule?.name || ''}
        fileType={editingRule?.sourceType || 'excel'}
        previewData={null}
        initialRule={editingRule || undefined}
        onSave={handleRuleSaved}
        onCancel={() => { setShowRuleEditor(false); setEditingRule(null); }}
      />
    )}
    </>
  );
}
