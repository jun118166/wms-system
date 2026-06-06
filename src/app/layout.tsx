import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: '万能导入 - 智能多格式批量下单系统',
  description: 'WMS智能仓储管理 - 批量下单系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <NavBar />
        <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
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
