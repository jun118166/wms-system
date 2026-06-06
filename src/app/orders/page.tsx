'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface OrderRecord {
  id: string;
  batch_id: string;
  external_code: string;
  store_name: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  sku_code: string;
  sku_name: string;
  sku_quantity: number;
  sku_spec: string;
  remark: string;
  created_at: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchExternalCode, setSearchExternalCode] = useState('');
  const [searchRecipient, setSearchRecipient] = useState('');
  const [pageSize, setPageSize] = useState(20);

  const loadOrders = useCallback(async (currentPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
      });
      if (searchExternalCode) params.set('externalCode', searchExternalCode);
      if (searchRecipient) params.set('recipientName', searchRecipient);

      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data.data || []);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
        setPage(currentPage);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [searchExternalCode, searchRecipient, pageSize]);

  useEffect(() => {
    loadOrders(1);
  }, [loadOrders]);

  const handleSearch = useCallback(() => {
    loadOrders(1);
  }, [loadOrders]);

  const handleExport = useCallback(() => {
    const header = '外部编码,收货门店,收件人姓名,收件人电话,收件人地址,SKU编码,SKU名称,发货数量,规格型号,备注\n';
    const csv = header + orders.map(o =>
      `"${o.external_code}","${o.store_name}","${o.recipient_name}","${o.recipient_phone}","${o.recipient_address}","${o.sku_code}","${o.sku_name}",${o.sku_quantity},"${o.sku_spec}","${o.remark}"`
    ).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `运单列表_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  }, [orders]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">已导入运单列表</h1>
        <p className="text-sm text-gray-400 mt-1">查看所有历史导入的运单记录</p>
      </div>

      {/* Search */}
      <div className="card !py-4">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchExternalCode}
            onChange={e => setSearchExternalCode(e.target.value)}
            placeholder="搜索外部编码..."
            className="input-field w-48"
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <input
            type="text"
            value={searchRecipient}
            onChange={e => setSearchRecipient(e.target.value)}
            placeholder="搜索收件人..."
            className="input-field w-48"
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} className="btn-primary">搜索</button>
          <button
            onClick={() => { setSearchExternalCode(''); setSearchRecipient(''); loadOrders(1); }}
            className="btn-secondary"
          >
            重置
          </button>
          <div className="flex-1" />
          <button onClick={handleExport} className="btn-secondary">导出CSV</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">加载中...</div>
      ) : orders.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-base text-gray-500 font-medium">暂无运单数据</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">导入文件并提交下单后，数据将显示在这里</p>
          <a href="/" className="btn-primary inline-block">开始导入</a>
        </div>
      ) : (
        <div className="overflow-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['外部编码', '收货门店', '收件人', '电话', '地址', 'SKU编码', 'SKU名称', '数量', '规格', '备注', '提交时间'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap border-b">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.id || i} className={clsx('hover:bg-gray-50/50', i % 2 === 0 && 'bg-white', i % 2 === 1 && 'bg-gray-50/30')}>
                  <td className="px-3 py-2 border-b text-xs max-w-[120px] truncate" title={o.external_code}>
                    {o.external_code || '-'}
                  </td>
                  <td className="px-3 py-2 border-b text-xs max-w-[140px] truncate" title={o.store_name}>
                    {o.store_name || '-'}
                  </td>
                  <td className="px-3 py-2 border-b text-xs">{o.recipient_name || '-'}</td>
                  <td className="px-3 py-2 border-b text-xs">{o.recipient_phone || '-'}</td>
                  <td className="px-3 py-2 border-b text-xs max-w-[160px] truncate" title={o.recipient_address}>
                    {o.recipient_address || '-'}
                  </td>
                  <td className="px-3 py-2 border-b text-xs font-mono">{o.sku_code || '-'}</td>
                  <td className="px-3 py-2 border-b text-xs">{o.sku_name || '-'}</td>
                  <td className="px-3 py-2 border-b text-xs text-center">{o.sku_quantity}</td>
                  <td className="px-3 py-2 border-b text-xs">{o.sku_spec || '-'}</td>
                  <td className="px-3 py-2 border-b text-xs text-gray-400 max-w-[120px] truncate">
                    {o.remark || '-'}
                  </td>
                  <td className="px-3 py-2 border-b text-xs text-gray-400 whitespace-nowrap">
                    {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            共 <span className="font-semibold text-gray-700">{total}</span> 条
          </div>
          <div className="flex items-center gap-2">
            {/* Page size selector */}
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); loadOrders(1); }}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value={10}>10条/页</option>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
              <option value={100}>100条/页</option>
            </select>

            {/* Page buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadOrders(page - 1)}
                disabled={page <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-md text-sm border border-gray-200 text-gray-500 hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ‹
              </button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => loadOrders(pageNum)}
                    className={clsx(
                      'w-8 h-8 flex items-center justify-center rounded-md text-sm font-medium transition-colors',
                      pageNum === page
                        ? 'bg-primary text-white'
                        : 'border border-gray-200 text-gray-600 hover:border-primary hover:text-primary'
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}

              {totalPages > 5 && page < totalPages - 2 && (
                <span className="w-8 h-8 flex items-center justify-center text-gray-400">...</span>
              )}

              {totalPages > 5 && page < totalPages - 2 && (
                <button
                  onClick={() => loadOrders(totalPages)}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-sm border border-gray-200 text-gray-600 hover:border-primary hover:text-primary transition-colors"
                >
                  {totalPages}
                </button>
              )}

              <button
                onClick={() => loadOrders(page + 1)}
                disabled={page >= totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-md text-sm border border-gray-200 text-gray-500 hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
