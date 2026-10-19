import React from 'react';
import { 
  Newspaper, 
  CheckCircle2, 
  Eye, 
  Send, 
  SlidersHorizontal, 
  History, 
  Save, 
  LogOut, 
  ChevronDown,
  Sparkles,
  WifiOff,
  BookOpen
} from 'lucide-react';
import { Article, User, USER_RANK_LABELS, canSubmitArticle, isHrAdmin, SaveStatus } from '../types';
import { NotificationCenter } from './notifications/NotificationCenter';
import { GlobalSearchBar } from './search/GlobalSearchBar';

interface TopHeaderProps {
  article: Article;
  currentUser: User;
  saveStatus: SaveStatus;
  lastSavedTime: string;
  activeScreen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media' | 'stt';
  isRightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
  unresolvedFeedbackCount?: number;
  onOpenVersionHistory: () => void;
  onOpenPreview: () => void;
  onOpenPublish: () => void;
  onNavigate: (screen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media' | 'stt') => void;
  onManualSave: () => void;
  onLogout: () => void;
  unresolvedAiCount?: number;
  isManagerReviewMode?: boolean;
  onSelectArticle?: (articleId: string, projectId?: string) => void;
  onSelectProject?: (projectId: string) => void;
  notificationTrigger?: number;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  article,
  currentUser,
  saveStatus,
  lastSavedTime,
  activeScreen,
  isRightPanelOpen,
  onToggleRightPanel,
  unresolvedFeedbackCount,
  onOpenVersionHistory,
  onOpenPreview,
  onOpenPublish,
  onNavigate,
  onManualSave,
  onLogout,
  unresolvedAiCount,
  isManagerReviewMode = false,
  onSelectArticle,
  onSelectProject,
  notificationTrigger,
}) => {
  const [userDropdownOpen, setUserDropdownOpen] = React.useState(false);
  const canPublish = canSubmitArticle(currentUser);
  const hrMode = isHrAdmin(currentUser);

  const getStatusBadge = () => {
    switch (article.status) {
      case 'draft':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-300">초안 작성중</span>;
      case 'review':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-800 border border-amber-300">데스크 감수중</span>;
      case 'proofread':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-800 border border-blue-300">교열/팩트체크</span>;
      case 'ready':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-300">출고 대기</span>;
      case 'published':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-900 text-white">출고 완료</span>;
      default:
        return null;
    }
  };

  return (
    <header 
      className="h-14 text-slate-100 border-b border-white/10 px-4 flex items-center justify-between select-none z-30 shrink-0 shadow-sm"
      style={{ background: 'var(--grad-topbar)' }}
    >
      {/* Brand & Active Project Info */}
      <div className="flex items-center space-x-4 min-w-0">
        <button
          id="btn-nav-brand"
          onClick={() => onNavigate(hrMode ? 'hr' : 'dashboard')}
          className="flex items-center space-x-2.5 text-left group focus:outline-none cursor-pointer"
        >
          <div className="w-8 h-8 rounded-md bg-white/15 text-white flex items-center justify-center font-bold shadow-2xs border border-white/20 group-hover:bg-white/25 transition-colors">
            <Newspaper className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-sm font-bold tracking-tight text-white">PRESS-CMS</span>
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-white/15 text-white/95 border border-white/20 rounded">
                {hrMode ? 'HR Portal' : 'Editorial Pro'}
              </span>
            </div>
            <p className="text-xs text-white/70 tracking-tight leading-none mt-0.5">
              {hrMode ? '인사·조직 관리 시스템' : 'Newsroom Workspace'}
            </p>
          </div>
        </button>

        <div className="h-4 w-px bg-white/20 mx-1 hidden md:block" />

        {/* Current Project / Article Breadcrumb or HR Badge */}
        {hrMode ? (
          <div className="hidden lg:flex items-center space-x-2 min-w-0 max-w-md">
            <span className="text-xs text-white/70 truncate font-semibold">[인사부]</span>
            <span className="text-xs font-semibold text-white truncate">
              회원가입 승인 및 조직·직책 마스터 관리
            </span>
          </div>
        ) : activeScreen === 'editor' ? (
          <div className="hidden lg:flex items-center space-x-2 min-w-0 max-w-md">
            <span className="text-xs text-white/70 truncate font-semibold">[{article.desk}]</span>
            <span className="text-xs font-semibold text-white truncate max-w-[280px]" title={article.projectName}>
              {article.projectName}
            </span>
            {getStatusBadge()}
          </div>
        ) : null}
      </div>

      {/* Auto-save & Status Center Area (에디터 화면에서는 EditorTopBar가 Canonical 인디케이터이므로 중복 제거) */}
      {!hrMode && activeScreen !== 'editor' ? (
        <div className="flex items-center space-x-3">
          {isManagerReviewMode ? (
            <div className="flex items-center space-x-2 text-xs bg-purple-900/60 text-purple-200 border border-purple-400/40 px-3 py-1 rounded-md shadow-xs select-none">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="font-bold">{currentUser.pendingApproval ? '승인 대기 · 읽기 전용' : '출고 검토 모드 · 읽기 전용'}</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-xs text-slate-200 bg-black/20 px-3 py-1 rounded-md border border-white/15">
              {saveStatus === 'offline' ? (
                <div className="flex items-center space-x-1.5 text-amber-300 font-medium">
                  <WifiOff className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                  <span>오프라인 — 변경사항이 아직 저장되지 않았습니다.</span>
                </div>
              ) : saveStatus === 'saving' ? (
                <div className="flex items-center space-x-1.5 text-amber-300 font-medium">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>저장 중...</span>
                </div>
              ) : saveStatus === 'error' ? (
                <div className="flex items-center space-x-1.5 text-rose-300 font-medium">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>저장 실패 (재시도 필요)</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-slate-200">
                  <span className="flex items-center space-x-1 text-white font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                    <span>저장됨</span>
                  </span>
                  <span className="text-white/30">|</span>
                  <span className="text-white/70 text-xs">마지막 저장 {lastSavedTime}</span>
                </div>
              )}
              <button 
                id="btn-manual-save"
                onClick={onManualSave}
                title="수동 저장 (Ctrl+S / Cmd+S)"
                className="ml-1 p-0.5 hover:text-white text-white/70 transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : <div />}

      {/* Global Search Bar (기사·프로젝트 통합 검색) */}
      {!hrMode && onSelectArticle && onSelectProject && (
        <GlobalSearchBar
          onSelectArticle={(articleId, projectId) => onSelectArticle(articleId, projectId)}
          onSelectProject={(projectId) => onSelectProject(projectId)}
        />
      )}

      {/* Action Buttons & User Profile */}
      <div className="flex items-center space-x-2 shrink-0">
        {!hrMode && (
          <>
            {/* Desk Feedback & AI Review Toggle Button */}
            {activeScreen === 'editor' && onToggleRightPanel && (
              <button
                id="btn-toggle-right-panel"
                onClick={onToggleRightPanel}
                className={`flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                  isRightPanelOpen 
                    ? 'bg-white text-slate-900 shadow-xs' 
                    : 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
                }`}
                title="데스크 피드백 및 AI 검수 패널 열기/닫기"
              >
                <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isRightPanelOpen ? 'text-blue-600' : 'text-blue-200'}`} />
                <span className="hidden sm:inline">피드백 · AI검수</span>
                {((unresolvedFeedbackCount || 0) + (unresolvedAiCount || 0)) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-xs bg-amber-500 text-white font-bold">
                    {(unresolvedFeedbackCount || 0) + (unresolvedAiCount || 0)}
                  </span>
                )}
              </button>
            )}

            {/* History (수정이력) Button */}
            <button
              id="btn-version-history"
              onClick={onOpenVersionHistory}
              className="flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white border border-white/15 whitespace-nowrap transition-colors cursor-pointer"
              title="수정이력 / 변경 내역"
            >
              <History className="w-3.5 h-3.5 text-white/80 shrink-0" />
              <span className="hidden sm:inline">수정이력</span>
            </button>

            {/* Article Preview Button */}
            <button
              id="btn-preview-article"
              onClick={onOpenPreview}
              className="flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white border border-white/15 whitespace-nowrap transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-white/80 shrink-0" />
              <span>미리보기</span>
            </button>

            {/* Publish Button (Only for 'manager' rank) */}
            {canPublish && (
              <button
                id="btn-publish-modal-trigger"
                onClick={onOpenPublish}
                className="flex items-center space-x-1.5 text-xs font-bold px-3.5 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-900 shadow-2xs whitespace-nowrap transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span>기사 출고</span>
              </button>
            )}

            <div className="h-4 w-px bg-white/20 mx-1" />
          </>
        )}

        {/* 인사부 전용 화면에는 왼쪽 메뉴가 없으므로 사용법 안내 버튼을 여기에 둔다 */}
        {hrMode && (
          <button
            id="btn-hr-guide"
            type="button"
            onClick={() => onNavigate('guide')}
            className="flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white whitespace-nowrap transition-colors cursor-pointer"
            title="사용법 안내 보기"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>사용법 안내</span>
          </button>
        )}

        {/* In-app Notification Center (모든 화면에서 업무 알림 확인 가능) */}
        {(onSelectArticle || hrMode) && (
          <NotificationCenter
            onSelectArticle={onSelectArticle}
            onOpenHr={hrMode ? () => onNavigate('hr') : undefined}
            refreshTrigger={notificationTrigger}
          />
        )}

        {/* User Profile & Role Switcher */}
        <div className="relative shrink-0">
          <button
            id="btn-user-menu"
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center space-x-2 pl-1 pr-2 py-1 rounded hover:bg-white/10 whitespace-nowrap transition-colors focus:outline-none cursor-pointer"
          >
            {currentUser.avatar ? (
              <img 
                src={currentUser.avatar} 
                alt={currentUser.name} 
                className="w-7 h-7 rounded-full object-cover border border-white/30 shrink-0"
              />
            ) : (
              // 프로필 사진이 없으면 이름 첫 글자로 동그라미를 대신 보여준다 (빈 src 경고 방지)
              <span
                aria-hidden="true"
                className="w-7 h-7 rounded-full border border-white/30 bg-white/20 text-white text-xs font-bold flex items-center justify-center shrink-0 select-none"
              >
                {(currentUser.name || '?').trim().charAt(0)}
              </span>
            )}
            <div className="text-left hidden md:block">
              <div className="text-xs font-semibold text-white leading-tight">
                {currentUser.name}
              </div>
              <p className="text-xs text-white/70 leading-tight mt-0.5">
                {currentUser.department} · {USER_RANK_LABELS[currentUser.rank]}
              </p>
            </div>
            <ChevronDown className="w-3 h-3 text-white/70 shrink-0" />
          </button>

          {userDropdownOpen && (
            <div className="absolute right-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-md shadow-xl py-1.5 z-50 text-xs animate-fade-in">
              <div className="px-3 py-2 border-b border-slate-800">
                <p className="font-semibold text-white text-sm">{currentUser.name}</p>
                <p className="text-slate-400 text-xs truncate mt-0.5">{currentUser.email}</p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-xs text-blue-300 font-medium">{currentUser.department} · {USER_RANK_LABELS[currentUser.rank]}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    hrMode 
                      ? 'bg-purple-950 text-purple-300 border border-purple-800' 
                      : canPublish 
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                        : 'bg-slate-800 text-slate-400'
                  }`}>
                    {hrMode ? '인사 관리자' : canPublish ? '출고 권한' : '작성 권한'}
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-800 my-1" />

              <button
                id="btn-header-settings"
                onClick={() => {
                  onNavigate('settings');
                  setUserDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>환경 설정 (Settings)</span>
              </button>

              <button
                id="btn-header-logout"
                onClick={() => {
                  onLogout();
                  setUserDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>로그아웃</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
