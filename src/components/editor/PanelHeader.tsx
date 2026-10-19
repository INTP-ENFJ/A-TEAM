import React from 'react';

/**
 * 오른쪽 작업 창(AI 초안 / 인포그래픽 / 피드백 / AI 검수)의 공통 머리글
 * - 아이콘 칸, 제목, 설명 글씨 크기와 색을 모두 같게 맞춥니다.
 */
interface Props {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  /** 머리글 아래 둘째 줄 (선택 도구 등) */
  children?: React.ReactNode;
}

export const PanelHeader: React.FC<Props> = ({ icon, title, subtitle, badge, actions, children }) => (
  <div className="px-4 py-3 bg-white border-b border-slate-200 shrink-0">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold text-slate-900 truncate">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="text-[12px] text-slate-600 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
    {children && <div className="mt-2.5">{children}</div>}
  </div>
);

/** 공통 보조 버튼 모양 */
export const PANEL_BTN_SECONDARY =
  'px-2.5 py-1 text-[12px] font-semibold rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
/** 공통 주요 버튼 모양 */
export const PANEL_BTN_PRIMARY =
  'px-2.5 py-1 text-[12px] font-bold rounded bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed whitespace-nowrap';
