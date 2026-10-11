import React from 'react';
import { 
  LayoutDashboard, 
  Image as ImageIcon,
  FileText, 
  History, 
  Settings as SettingsIcon,
  ShieldCheck,
  BookOpen
} from 'lucide-react';
import { Article } from '../types';

interface LeftSidebarProps {
  activeScreen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media';
  onNavigate: (screen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media') => void;
  onOpenVersionHistory: () => void;
  article: Article;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeScreen,
  onNavigate,
  onOpenVersionHistory,
  article,
}) => {
  // Editorial calculations
  const charWithSpaces = article.blocks.reduce((acc, b) => acc + (b.text?.length || 0), 0) + article.title.length + article.subtitle.length;
  const charWithoutSpaces = (article.blocks.reduce((acc, b) => acc + (b.text?.replace(/\s+/g, '').length || 0), 0) + article.title.replace(/\s+/g, '').length);
  const paragraphCount = article.blocks.filter(b => b.type === 'paragraph').length;

  return (
    <aside 
      className="w-60 text-slate-300 border-r border-white/10 flex flex-col justify-between select-none shrink-0 h-full shadow-lg"
      style={{ background: 'var(--grad-sidebar)' }}
    >
      {/* Top Menu Links */}
      <div className="p-3 space-y-6 overflow-y-auto">
        <div>
          <div className="px-3 pb-2 text-[11px] font-bold text-white/60 uppercase tracking-wider">
            EDITORIAL NAVIGATION
          </div>
          <nav className="space-y-1">
            <button
              id="sidebar-nav-dashboard"
              onClick={() => onNavigate('dashboard')}
              style={activeScreen === 'dashboard' ? { background: 'var(--grad-active)' } : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'dashboard'
                  ? 'text-white font-bold shadow-xs'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
                <LayoutDashboard className="w-4 h-4 text-white shrink-0" />
                <span>Dashboard</span>
              </div>
              <span className="text-[11px] text-white/70 whitespace-nowrap shrink-0">대시보드</span>
            </button>

            <button
              id="sidebar-nav-article"
              onClick={() => onNavigate('editor')}
              style={activeScreen === 'editor' ? { background: 'var(--grad-active)' } : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'editor'
                  ? 'text-white font-bold shadow-xs'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
                <FileText className="w-4 h-4 text-white shrink-0" />
                <span>Article</span>
              </div>
              <span className="text-[11px] text-white/70 whitespace-nowrap shrink-0">기사 편집기</span>
            </button>

            <button
              id="sidebar-nav-media"
              onClick={() => onNavigate('media')}
              style={activeScreen === 'media' ? { background: 'var(--grad-active)' } : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'media'
                  ? 'text-white font-bold shadow-xs'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
                <ImageIcon className="w-4 h-4 text-white shrink-0" />
                <span>Media</span>
              </div>
              <span className="text-[11px] text-white/70 whitespace-nowrap shrink-0">미디어 라이브러리</span>
            </button>

            <button
              id="sidebar-nav-history"
              onClick={onOpenVersionHistory}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
                <History className="w-4 h-4 text-white/80 shrink-0" />
                <span>History</span>
              </div>
              <span className="text-[11px] text-white/60 whitespace-nowrap shrink-0">이력·업무로그</span>
            </button>

            <button
              id="sidebar-nav-settings"
              onClick={() => onNavigate('settings')}
              style={activeScreen === 'settings' ? { background: 'var(--grad-active)' } : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'settings'
                  ? 'text-white font-bold shadow-xs'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
                <SettingsIcon className="w-4 h-4 text-white/80 shrink-0" />
                <span>Settings</span>
              </div>
              <span className="text-[11px] text-white/70 whitespace-nowrap shrink-0">환경 설정</span>
            </button>
          </nav>
        </div>

        {/* Real-time Article Metrics (When in Article Editor) */}
        {activeScreen === 'editor' && (
          <div className="bg-white/5 p-3 rounded-lg border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">기사 원고 분량</span>
              <span className="text-[10px] text-white/60 font-semibold px-1.5 py-0.5 rounded bg-white/10">실시간</span>
            </div>

            <div className="flex flex-col space-y-2">
              <div className="bg-black/20 px-3 py-2 rounded border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">글자수</span>
                <span className="text-sm font-bold text-white">{charWithoutSpaces.toLocaleString()}</span>
              </div>
              <div className="bg-black/20 px-3 py-2 rounded border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">공백포함</span>
                <span className="text-sm font-bold text-white">{charWithSpaces.toLocaleString()}</span>
              </div>
              <div className="bg-black/20 px-3 py-2 rounded border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">문단</span>
                <span className="text-sm font-bold text-white">{paragraphCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Area: User Guide & Editorial Principle */}
      <div className="p-3 border-t border-white/10 bg-black/20 space-y-3">
        {/* 사용법 안내 버튼 (상단 핵심 메뉴와 분리하여 하단 구석 배치) */}
        <button
          id="sidebar-nav-guide"
          type="button"
          onClick={() => onNavigate('guide')}
          style={activeScreen === 'guide' ? { background: 'var(--grad-active)' } : undefined}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeScreen === 'guide'
              ? 'text-white font-bold shadow-xs'
              : 'text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
          title="처음 사용하는 분을 위한 쉬운 사용법 안내"
        >
          <div className="flex items-center space-x-2.5 whitespace-nowrap shrink-0">
            <BookOpen className="w-4 h-4 text-blue-300 shrink-0" />
            <span>Guide</span>
          </div>
          <span className="text-[10px] text-white/80 font-medium px-1.5 py-0.5 rounded bg-white/10 whitespace-nowrap shrink-0">
            사용법 안내
          </span>
        </button>

        {/* 기자 중심 집필 원칙 */}
        <div className="pt-2 border-t border-white/10 flex items-start space-x-2 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-white block">기자 중심 집필 원칙</span>
            <span className="text-[11px] text-white/70 leading-snug block mt-0.5">
              기자가 작성한 원문 중심의 Editorial CMS 기준을 준수합니다.
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
