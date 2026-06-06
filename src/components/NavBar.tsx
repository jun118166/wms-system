'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const navItems = [
  { href: '/', label: '导入下单', icon: '📦' },
  { href: '/rules', label: '解析规则', icon: '⚙️' },
  { href: '/orders', label: '已导入运单', icon: '📋' },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
              <span className="text-white font-bold text-xs">WMS</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-base text-gray-900">万能导入 V2</span>
              <span className="text-xs text-gray-400 hidden sm:inline">智能批量下单系统</span>
            </div>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-light text-primary-deep'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <span>{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
