'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ParseRule } from '@/lib/types';
import clsx from 'clsx';

interface RuleSelectorProps {
  selectedRuleId: string | null;
  onSelect: (ruleId: string, ruleConfig: ParseRule) => void;
  onCreateNew: () => void;
  currentFileType?: 'excel' | 'word' | 'pdf' | null;
}

export default function RuleSelector({ selectedRuleId, onSelect, onCreateNew, currentFileType }: RuleSelectorProps) {
  const [rules, setRules] = useState<(ParseRule & { id: string; name: string; description: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      if (data.success) {
        const mappedRules = data.data.map((r: any) => ({
          ...r.config,
          id: r.id,
          name: r.name,
          description: r.description,
        }));
        setRules(mappedRules);
      }
    } catch (e) {
      console.error('加载规则失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const filteredRules = rules.filter(r => {
    if (search && !r.name.includes(search) && !r.description?.includes(search)) return false;
    if (currentFileType && r.sourceType !== currentFileType) return false;
    return true;
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-800">选择解析规则</h3>
        <button onClick={onCreateNew} className="btn-primary text-sm px-4 py-1.5">
          + 新建规则
        </button>
      </div>

      <input
        type="text"
        placeholder="搜索规则..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="input-field mb-3"
      />

      {loading ? (
        <div className="text-center py-6 text-gray-400 text-sm">加载中...</div>
      ) : filteredRules.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          {rules.length === 0 ? '暂无解析规则，请先创建' : '无匹配规则'}
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {filteredRules.map(rule => (
            <div
              key={rule.id}
              onClick={() => onSelect(rule.id, rule.config || rule)}
              className={clsx(
                'p-3 rounded-lg border cursor-pointer transition-all',
                selectedRuleId === rule.id
                  ? 'border-primary bg-primary-light'
                  : 'border-gray-100 hover:border-gray-200 bg-white'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{rule.name}</span>
                <span className={clsx(
                  'badge',
                  rule.sourceType === 'excel' ? 'badge-success' :
                  rule.sourceType === 'word' ? 'badge-warning' : 'badge-info'
                )}>
                  {rule.sourceType}
                </span>
              </div>
              {rule.description && (
                <p className="text-xs text-gray-400 mt-1 truncate">{rule.description}</p>
              )}
              {rule.aiGenerated && (
                <span className="badge badge-info text-xs mt-1">AI生成</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
