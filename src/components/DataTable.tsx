'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import type { OrderItem, ValidationError } from '@/lib/types';
import clsx from 'clsx';

const FIELDS: { key: keyof OrderItem; label: string; width: number; required: boolean }[] = [
  { key: 'externalCode', label: '外部编码', width: 140, required: false },
  { key: 'storeName', label: '收货门店', width: 160, required: false },
  { key: 'recipientName', label: '收件人姓名', width: 120, required: false },
  { key: 'recipientPhone', label: '收件人电话', width: 130, required: false },
  { key: 'recipientAddress', label: '收件人地址', width: 200, required: false },
  { key: 'skuCode', label: 'SKU编码', width: 120, required: true },
  { key: 'skuName', label: 'SKU名称', width: 150, required: true },
  { key: 'skuQuantity', label: '发货数量', width: 90, required: true },
  { key: 'skuSpec', label: '规格型号', width: 100, required: false },
  { key: 'remark', label: '备注', width: 150, required: false },
];

interface DataTableProps {
  data: OrderItem[];
  onDataChange: (data: OrderItem[]) => void;
  onDeleteRow: (index: number) => void;
  onAddRow: () => void;
}

const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 25;

export default function DataTable({ data, onDataChange, onDeleteRow, onAddRow }: DataTableProps) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Virtual list calculation
  const totalHeight = data.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const endIdx = Math.min(data.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + 5);
  const visibleData = data.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  const isLargeDataset = data.length > 100;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleCellClick = useCallback((globalRowIndex: number, field: string, currentValue: any) => {
    setEditingCell({ row: globalRowIndex, col: field });
    setEditValue(String(currentValue || ''));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleCellBlur = useCallback(() => {
    if (!editingCell) return;
    const newData = [...data];
    const row = { ...newData[editingCell.row] };
    (row as any)[editingCell.col] = editValue;

    if (editingCell.col === 'skuQuantity') {
      (row as any).skuQuantity = Number(editValue) || 0;
    }

    newData[editingCell.row] = row;
    onDataChange(newData);
    setEditingCell(null);
  }, [editingCell, editValue, data, onDataChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleCellBlur();
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [handleCellBlur]);

  const renderCellValue = useCallback((item: OrderItem, field: string) => {
    const val = (item as any)[field];
    return val !== undefined && val !== null ? String(val) : '';
  }, []);

  const getRowErrors = useCallback((item: OrderItem): ValidationError[] => {
    return item.__errors || [];
  }, []);

  const errorCount = useMemo(() =>
    data.reduce((sum, item) => sum + (item.__errors?.length || 0), 0),
    [data]
  );

  // Callback to measure container height
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    (containerRef as any).current = node;
    if (node) {
      setContainerHeight(node.clientHeight || 600);
    }
  }, []);

  if (data.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <svg className="w-16 h-16 mx-auto mb-4 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 10h18M3 14h18M3 7h18M3 17h18" />
        </svg>
        <p className="text-base">暂无数据</p>
        <p className="text-sm mt-1">请上传文件并选择解析规则后执行解析</p>
      </div>
    );
  }

  const renderTableHeader = () => (
    <thead>
      <tr className="bg-gray-50">
        <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-12 border-b border-r">
          #
        </th>
        {FIELDS.map(f => (
          <th
            key={f.key}
            className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 border-b whitespace-nowrap"
            style={{ minWidth: f.width }}
          >
            {f.label}
            {f.required && <span className="text-red-400 ml-0.5">*</span>}
          </th>
        ))}
        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 border-b w-20">
          操作
        </th>
      </tr>
    </thead>
  );

  const renderRow = (item: OrderItem, globalRowIdx: number) => {
    const errors = getRowErrors(item);
    const hasError = errors.length > 0;
    const hasDup = !!item.__duplicateWith;

    return (
      <tr
        key={globalRowIdx}
        className={clsx(
          'transition-colors',
          hasError ? 'bg-red-50/30 hover:bg-red-100/30' :
          hasDup ? 'bg-orange-50/30 hover:bg-orange-100/30' :
          'hover:bg-gray-50/50'
        )}
        style={{ height: ROW_HEIGHT }}
      >
        <td className="sticky left-0 bg-white px-3 py-0 text-gray-400 text-xs border-b border-r">
          <div className="h-full flex items-center">{globalRowIdx + 1}</div>
        </td>
        {FIELDS.map(f => {
          const isEditing = editingCell?.row === globalRowIdx && editingCell?.col === f.key;
          const fieldErrors = errors.filter(e => e.field === f.key);
          const hasFieldError = fieldErrors.length > 0;

          return (
            <td
              key={f.key}
              className={clsx(
                'px-3 py-0 border-b cursor-pointer transition-colors',
                hasFieldError && 'bg-red-100/50',
                isEditing && 'ring-2 ring-primary ring-inset bg-white'
              )}
              style={{ minWidth: f.width }}
              onClick={() => handleCellClick(globalRowIdx, f.key, (item as any)[f.key])}
            >
              <div className="h-full flex flex-col justify-center min-h-[42px]">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={handleCellBlur}
                    onKeyDown={handleKeyDown}
                    className="w-full outline-none bg-transparent text-sm"
                    autoFocus
                  />
                ) : (
                  <>
                    <span className={clsx(
                      'text-sm',
                      !renderCellValue(item, f.key) && 'text-gray-300 italic'
                    )}>
                      {renderCellValue(item, f.key) || '空'}
                    </span>
                    {hasFieldError && (
                      <span className="text-[10px] text-red-500 leading-tight">
                        {fieldErrors.map(e => e.message).join(', ')}
                      </span>
                    )}
                  </>
                )}
              </div>
            </td>
          );
        })}
        <td className="px-3 py-0 border-b">
          <div className="h-full flex items-center">
            <button
              onClick={() => onDeleteRow(globalRowIdx)}
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
            >
              删除
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">共 {data.length} 条记录</span>
          {errorCount > 0 && (
            <span className="badge badge-error">{errorCount} 个错误</span>
          )}
        </div>
        <button onClick={onAddRow} className="btn-secondary text-sm">
          + 新增行
        </button>
      </div>

      <div className="overflow-hidden border border-gray-200 rounded-xl">
        {/* Standard render for small datasets */}
        {!isLargeDataset ? (
          <div className="overflow-auto max-h-[70vh]" ref={setContainerRef}>
            <table className="w-full border-collapse text-sm">
              {renderTableHeader()}
              <tbody>
                {data.map((item, idx) => renderRow(item, idx))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Virtual list render for large datasets (1000+) */
          <div
            className="overflow-auto"
            style={{ height: Math.min(containerHeight, 600) }}
            onScroll={handleScroll}
            ref={setContainerRef}
          >
            <table className="w-full border-collapse text-sm">
              {renderTableHeader()}
              <tbody>
                {/* Spacer for virtual scroll */}
                <tr style={{ height: offsetY }} />
                {visibleData.map((item, idx) => {
                  const globalIdx = startIdx + idx;
                  return renderRow(item, globalIdx);
                })}
                {/* Bottom spacer */}
                <tr style={{ height: totalHeight - (endIdx * ROW_HEIGHT) }} />
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Performance notice for large datasets */}
      {data.length > 500 && (
        <p className="text-xs text-gray-400 mt-1.5">
          已启用虚拟列表优化，当前展示 {data.length} 条数据的其中 {endIdx - startIdx} 行
        </p>
      )}
    </div>
  );
}
