import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import SideNav from '@/components/SideNav';

export const metadata: Metadata = {
  title: '万能导入 - 智能多格式批量下单系统',
  description: 'WMS智能仓储管理 - 批量下单系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <div className="flex min-h-screen">
          <SideNav />
          <main className="flex-1 px-6 py-6 overflow-auto">
            {children}
          </main>
        </div>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              fontSize: '14px',
              borderRadius: '10px',
              background: '#333',
              color: '#fff',
            },
          }}
        />
      </body>
    </html>
  );
}
