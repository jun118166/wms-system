'use client';

import clsx from 'clsx';

interface ProgressBarProps {
  progress: number; // 0-100
  indeterminate?: boolean;
  label?: string;
  sublabel?: string;
  visible: boolean;
}

export default function ProgressBar({ progress, indeterminate, label, sublabel, visible }: ProgressBarProps) {
  if (!visible) return null;

  return (
    <div className="card !py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{label || '处理中...'}</span>
        {!indeterminate && <span className="text-sm text-primary font-semibold">{Math.round(progress)}%</span>}
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-300',
            indeterminate
              ? 'bg-primary w-1/4 progress-indeterminate'
              : 'bg-primary'
          )}
          style={indeterminate ? undefined : { width: `${progress}%` }}
        />
      </div>
      {sublabel && <p className="text-xs text-gray-400 mt-1.5">{sublabel}</p>}
    </div>
  );
}
