'use client';

interface DateRangePickerProps {
  value: string;
  onChange: (window: string) => void;
}

const OPTIONS = ['1h', '6h', '24h', '7d', '30d'];

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#0f0f1c] p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`
            px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200
            ${value === opt
              ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-sm'
              : 'text-[#8b8ba8] hover:text-white hover:bg-white/[0.05]'
            }
          `}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
