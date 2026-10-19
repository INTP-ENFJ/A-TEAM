import React, { useState, useRef } from 'react';
import { VisibilityPicker } from '../common/VisibilityPicker';
import { createPortal } from 'react-dom';
import { 
  CheckCircle2, 
  Save, 
  Clock, 
  Send, 
  AlignLeft,
  ImageIcon,
  Download,
  FileText,
  Sparkles,
  Globe,
  Lock,
  Upload,
  AlertCircle,
  FileCheck2,
  RotateCcw,
  WifiOff
} from 'lucide-react';
import { Article, ArticleStatus, SaveStatus, ProjectVisibility } from '../../types';
import { ArticleStatusBadge } from '../common/ArticleStatusBadge';

interface EditorTopBarProps {
  article: Article;
  onStatusChange?: (status: ArticleStatus) => void;
  onToggleShare?: () => void;
  onSelectVisibility?: (visibility: ProjectVisibility) => void;
  saveStatus?: SaveStatus;
  lastSavedTime?: string;
  onManualSave?: () => void;
  onExportTxt?: () => void;
  onExportDoc?: () => void;
  onOpenTxtImport?: () => void;
  onOpenMediaDrawer: () => void;
  unresolvedFeedbackCount?: number;
  unresolvedAiCount?: number;
  isManagerReviewMode?: boolean;
  // Workflow 액션 및 권한 Props
  onRequestReview?: () => void;
  onRequestChanges?: () => void;
  onApproveArticle?: () => void;
  isDesk?: boolean;
  isAuthor?: boolean;
  isWorkflowLoading?: boolean;
  onToggleAiTools?: () => void;
  isAiToolsOpen?: boolean;
}

export const EditorTopBar: React.FC<EditorTopBarProps> = ({
  article,
  onStatusChange,
  onToggleShare,
  onSelectVisibility,
  saveStatus = 'saved',
  lastSavedTime = article.lastSaved,
  onManualSave,
  onExportTxt,
  onExportDoc,
  onOpenTxtImport,
  onOpenMediaDrawer,
  unresolvedFeedbackCount = 0,
  unresolvedAiCount = 0,
  isManagerReviewMode = false,
  onRequestReview,
  onRequestChanges,
  onApproveArticle,
  isDesk = false,
  isAuthor = true,
  isWorkflowLoading = false,
  onToggleAiTools,
  isAiToolsOpen = false,
}) => {
  const [isExportOpen, setIsExportOpen] = useState(false);
  // 상단 바가 가로 스크롤 영역이라 메뉴가 잘리므로, 내보내기 메뉴는 화면 위에 따로 띄운다
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportMenuPos, setExportMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const toggleExportMenu = () => {
    const r = exportBtnRef.current?.getBoundingClientRect();
    if (r) setExportMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setIsExportOpen(v => !v);
  };

  return (
    <div className="sticky top-0 z-20 w-full bg-white border-b border-slate-200 px-4 sm:px-6 py-2 shadow-2xs flex items-center justify-between gap-3 select-none min-h-[48px] overflow-x-auto">
      {/* 1. Article Status & Workflow Actions */}
      <div className="flex items-center space-x-2.5 shrink-0 flex-nowrap">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-500 hidden sm:inline whitespace-nowrap">
            기사 상태:
          </span>

          {/* 현재 기사 상태 뱃지 및 상태 변경 셀렉트 (모든 상태 간 앞뒤 자유 전환 지원) */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <ArticleStatusBadge status={article.status} size="md" showDot={true} />
            {onStatusChange && (
              <select
                id="select-article-status"
                value={article.status}
                onChange={(e) => onStatusChange(e.target.value as ArticleStatus)}
                className="text-[12px] font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded px-1.5 py-0.5 text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors shadow-2xs"
                title="기사 상태 직접 변경 (초안, 검토 대기, 출고 대기 등 언제든 자유롭게 전환 가능)"
              >
                <option value="draft">초안</option>
                <option value="review">검토 대기</option>
                <option value="changes_requested">수정 요청</option>
                <option value="ready">출고 대기</option>
                <option value="published">출고 완료</option>
              </select>
            )}
          </div>

          {/* Workflow 액션 버튼 영역 */}
          <div className="flex items-center space-x-1.5 pl-1.5 border-l border-slate-200 shrink-0">
            {/* 1) 기자 액션: 초안 작성중 -> 검토 요청 */}
            {isAuthor && article.status === 'draft' && onRequestReview && (
              <button
                id="btn-workflow-request-review"
                type="button"
                disabled={isWorkflowLoading}
                onClick={onRequestReview}
                className="flex items-center space-x-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded font-bold text-xs transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                title="작성 완료된 기사를 데스크에 검토 요청합니다"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isWorkflowLoading ? '처리 중...' : '검토 요청'}</span>
              </button>
            )}

            {/* 2) 기자 액션: 수정요청됨 -> 재검토 요청 */}
            {isAuthor && article.status === 'changes_requested' && onRequestReview && (
              <button
                id="btn-workflow-request-rereview"
                type="button"
                disabled={isWorkflowLoading}
                onClick={onRequestReview}
                className="flex items-center space-x-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded font-bold text-xs transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                title="수정 사항을 반영하여 데스크에 재검토를 요청합니다"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isWorkflowLoading ? '처리 중...' : '재검토 요청'}</span>
              </button>
            )}

            {/* 3) 데스크 액션: 검토중일 때 -> [수정 요청] 및 [기사 승인] */}
            {isDesk && article.status === 'review' && (
              <div className="flex items-center space-x-1.5 shrink-0">
                {onRequestChanges && (
                  <button
                    id="btn-workflow-request-changes"
                    type="button"
                    disabled={isWorkflowLoading}
                    onClick={onRequestChanges}
                    className="flex items-center space-x-1 px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded font-bold text-xs transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                    title="기자에게 수정 요청 사유를 전달합니다"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>수정 요청</span>
                  </button>
                )}
                {onApproveArticle && (
                  <button
                    id="btn-workflow-approve"
                    type="button"
                    disabled={isWorkflowLoading}
                    onClick={onApproveArticle}
                    className="flex items-center space-x-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded font-bold text-xs transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                    title="기사를 최종 승인하여 출고 대기 상태로 전환합니다"
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>{isWorkflowLoading ? '승인 중...' : '승인'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3단계 공개 범위 설정 (비공개 / 같은 부서 공개 / 전체 공개) */}
        <div className="flex items-center border-l border-slate-200 pl-2 shrink-0">
          <VisibilityPicker
            id="select-editor-visibility"
            disabled={isManagerReviewMode}
            value={article.visibility}
            onChange={(val) => {
              if (onSelectVisibility) {
                onSelectVisibility(val);
              } else if (onToggleShare) {
                onToggleShare();
              }
            }}
          />
        </div>
      </div>

      {/* 2. Save Status Indicator / Manager Review Mode Badge */}
      <div className="flex items-center space-x-3 text-xs shrink-0">
        {isManagerReviewMode ? (
          <div 
            id="editor-review-mode-indicator"
            className="inline-flex items-center space-x-1.5 px-3 py-1 rounded bg-purple-50 text-purple-700 border border-purple-300 text-xs font-bold select-none whitespace-nowrap shadow-2xs"
            title="다른 기자의 출고 대기 기사 검토 모드입니다. 수정할 수 없으며 상단 [기사 출고]를 통해 출고할 수 있습니다."
          >
            <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
            <span>출고 검토 모드 · 읽기 전용</span>
          </div>
        ) : (
          <div 
            id="editor-save-indicator"
            className="flex items-center space-x-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-md whitespace-nowrap"
          >
            {saveStatus === 'offline' ? (
              <div className="flex items-center space-x-1.5 text-amber-700 font-semibold animate-pulse">
                <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                <span>오프라인 (저장 대기)</span>
              </div>
            ) : saveStatus === 'saving' ? (
              <div className="flex items-center space-x-1.5 text-amber-600 font-semibold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <span>저장 중...</span>
              </div>
            ) : saveStatus === 'error' ? (
              <div className="flex items-center space-x-1.5 text-rose-600 font-semibold">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>저장 실패 (재시도 필요)</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-slate-700">
                <span className="flex items-center space-x-1 text-slate-800 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-700" />
                  <span>저장됨</span>
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500 text-xs flex items-center space-x-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>마지막 저장 {lastSavedTime}</span>
                </span>
              </div>
            )}

            {onManualSave && (
              <button
                id="btn-editor-manual-save"
                type="button"
                onClick={onManualSave}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded transition-colors ml-1"
                title="수동 저장 (Ctrl+S / Cmd+S)"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* 3. TXT Import, Export Actions & Media Drawer button */}
        <div className="flex items-center space-x-1.5 pl-1 border-l border-slate-200 relative">
          {/* TXT 가져오기 (Manager Review 모드에서는 숨김/차단) */}
          {!isManagerReviewMode && onOpenTxtImport && (
            <button
              id="btn-topbar-open-txt-import"
              type="button"
              onClick={onOpenTxtImport}
              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded font-semibold text-xs transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
              title="텍스트 파일(.txt) 내용 가져오기"
            >
              <Upload className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>TXT 가져오기</span>
            </button>
          )}

          <div className="relative">
            <button
              id="btn-export-dropdown"
              ref={exportBtnRef}
              type="button"
              onClick={toggleExportMenu}
              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded font-medium text-xs transition-colors shadow-2xs"
              title="기사 파일 내보내기 (Word, TXT)"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>내보내기</span>
            </button>

            {isExportOpen && createPortal(
              <>
              <div className="fixed inset-0 z-[99]" onClick={() => setIsExportOpen(false)} />
              <div 
                style={{ position: 'fixed', top: exportMenuPos.top, right: exportMenuPos.right }}
                className="w-40 bg-white rounded-md shadow-lg border border-slate-200 py-1 z-[100] text-xs text-slate-700"
              >
                {onExportDoc && (
                  <button
                    type="button"
                    id="btn-export-word"
                    onClick={() => {
                      setIsExportOpen(false);
                      onExportDoc();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-700 flex items-center space-x-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>워드 문서 (.docx)</span>
                  </button>
                )}
                {onExportTxt && (
                  <button
                    type="button"
                    id="btn-export-txt"
                    onClick={() => {
                      setIsExportOpen(false);
                      onExportTxt();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-700 flex items-center space-x-2"
                  >
                    <AlignLeft className="w-3.5 h-3.5 text-slate-600" />
                    <span>텍스트 파일 (.txt)</span>
                  </button>
                )}
              </div>
              </>,
              document.body
            )}
          </div>

          <button
            id="btn-topbar-open-media"
            type="button"
            onClick={onOpenMediaDrawer}
            className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded font-medium text-xs transition-colors shadow-2xs whitespace-nowrap shrink-0"
            title="오른쪽 작업 창에서 미디어 라이브러리 열기 (사진·영상을 본문으로 끌어다 놓을 수 있어요)"
          >
            <ImageIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>미디어</span>
          </button>

          {/* AI 도구 (AI 초안 · 인포그래픽 · 피드백 · AI 검수) 한 버튼으로 묶음 */}
          {onToggleAiTools && (
            <button
              id="btn-topbar-ai-tools"
              type="button"
              onClick={onToggleAiTools}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded font-bold text-xs transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer border ${
                isAiToolsOpen
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
              }`}
              title="AI 초안 작성 · 인포그래픽 · 데스크 피드백 · AI 검수를 옆 창에서 사용합니다"
            >
              <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isAiToolsOpen ? 'text-blue-100' : 'text-blue-600'}`} />
              <span className="whitespace-nowrap">AI 도구</span>
              {(unresolvedFeedbackCount + unresolvedAiCount) > 0 && (
                <span className="px-1.5 rounded-full text-[12px] leading-4 bg-amber-500 text-white font-bold shrink-0">
                  {unresolvedFeedbackCount + unresolvedAiCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
