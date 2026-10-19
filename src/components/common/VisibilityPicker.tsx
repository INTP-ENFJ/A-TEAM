import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Users, Globe, ChevronDown, Check } from 'lucide-react';
import type { ProjectVisibility } from '../../types';

/**
 * 공개 범위 3칸 선택기 (나만 / 우리 부서 / 전체)
 * - 누르면 설명이 붙은 3가지 선택지가 뜹니다.
 * - 표/상단 바처럼 잘리는 곳에서도 보이도록 화면 위에 따로 띄웁니다.
 */
const OPTIONS: { value: ProjectVisibility; label: string; short: string; desc: string; Icon: typeof Lock }[] = [
  { value: 'private', label: '나만 보기', short: '나만', desc: '나만 볼 수 있습니다.', Icon: Lock },
  { value: 'department', label: '우리 부서', short: '우리 부서', desc: '같은 부서 사람들이 볼 수 있습니다.', Icon: Users },
  { value: 'shared', label: '전체 공개', short: '전체', desc: '회사 모든 사람이 볼 수 있습니다.', Icon: Globe },
];

interface Props {
  value?: ProjectVisibility;
  onChange: (next: ProjectVisibility) => void;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
}

export const VisibilityPicker: React.FC<Props> = ({ value, onChange, disabled, id, compact }) => {
  const current = OPTIONS.find(o => o.value === (value || 'private')) || OPTIONS[0];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const closeScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeScroll, true);
    window.addEventListener('resize', closeScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeScroll, true);
      window.removeEventListener('resize', closeScroll);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = 240;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 4, left });
    }
    setOpen(o => !o);
  };

  const tone =
    current.value === 'shared'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
      : current.value === 'department'
        ? 'bg-blue-50 border-blue-300 text-blue-800'
        : 'bg-slate-50 border-slate-300 text-slate-700';

  return (
    <div className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <button
        id={id}
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        title={`지금 공개 범위: ${current.label} - ${current.desc}`}
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[12px] font-semibold shadow-2xs whitespace-nowrap transition-colors ${tone} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:brightness-95'}`}
      >
        <current.Icon className="w-3 h-3" />
        <span>{compact ? current.short : current.label}</span>
        {!disabled && <ChevronDown className="w-3 h-3 opacity-60" />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-lg shadow-lg p-1 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 pt-1.5 pb-1 text-[12px] font-bold text-slate-500">누가 볼 수 있게 할까요?</div>
          {OPTIONS.map(o => {
            const active = o.value === current.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { setOpen(false); if (!active) onChange(o.value); }}
                className={`w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left cursor-pointer ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <o.Icon className="w-3.5 h-3.5 mt-0.5 text-slate-600 shrink-0" />
                <span className="flex-1">
                  <span className="block text-xs font-bold text-slate-800">{o.label}</span>
                  <span className="block text-[12px] text-slate-500">{o.desc}</span>
                </span>
                {active && <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />}
              </button>
            );
          })}
          <div className="mx-2 my-1.5 border-t border-slate-100 pt-1.5 text-[12px] text-slate-400 leading-snug">
            초안 상태에서는 공개로 바꿔도 다른 사람에게 보이지 않습니다. 검토 요청 이후부터 보입니다.
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
