import React, { useState } from 'react';
import { PanelHeader, PANEL_BTN_SECONDARY } from './PanelHeader';
import { 
  SpellCheck, 
  AlignLeft, 
  FileSearch, 
  BookOpen, 
  Check, 
  X, 
  RotateCcw, 
  Sparkles, 
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  Info
} from 'lucide-react';
import { AiReviewItem, AiReviewCategory } from '../../types';

interface AiReviewPanelProps {
  reviews: AiReviewItem[];
  selectedReviewId: string | null;
  onSelectReview: (id: string) => void;
  onResolveReview: (id: string) => void;
  onIgnoreReview: (id: string) => void;
  onUndoReview: (id: string) => void;
  onRunAiScan: () => void;
  isScanning: boolean;
  cooldownSeconds?: number;
  onFocusBlock?: (blockId: string, sourceText?: string) => void;
}

export const AiReviewPanel: React.FC<AiReviewPanelProps> = ({
  reviews,
  selectedReviewId,
  onSelectReview,
  onResolveReview,
  onIgnoreReview,
  onUndoReview,
  onRunAiScan,
  isScanning,
  cooldownSeconds = 0,
  onFocusBlock,
}) => {
  // 4개 검수 영역 탭: [맞춤법·오탈자] [비문·문장 구조] [제목·본문 비교] [기사 표기법]
  const [activeCategory, setActiveCategory] = useState<AiReviewCategory>('spelling');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all');

  // 카테고리별 분류 (기존 mock 데이터 type과의 하위 호환성 매핑 포함)
  const getCategoryMatches = (cat: AiReviewCategory) => {
    return reviews.filter(r => {
      if (r.category) return r.category === cat;
      // 기존 mock 호환 매핑
      if (cat === 'spelling') return r.type === 'typo';
      if (cat === 'grammar') return false;
      if (cat === 'title_mismatch') return false;
      if (cat === 'style_guide') return r.type === 'information_check';
      return false;
    });
  };

  const spellingItems = getCategoryMatches('spelling');
  const grammarItems = getCategoryMatches('grammar');
  const titleMismatchItems = getCategoryMatches('title_mismatch');
  const styleGuideItems = getCategoryMatches('style_guide');

  // 각 탭별 대기(pending) 건수
  const pendingCounts: Record<AiReviewCategory, number> = {
    spelling: spellingItems.filter(r => r.status === 'pending').length,
    grammar: grammarItems.filter(r => r.status === 'pending').length,
    title_mismatch: titleMismatchItems.filter(r => r.status === 'pending').length,
    style_guide: styleGuideItems.filter(r => r.status === 'pending').length,
  };

  // 선택된 탭 및 상태 필터링에 따른 목록
  const getTabItems = () => {
    let list: AiReviewItem[] = [];
    if (activeCategory === 'spelling') list = spellingItems;
    else if (activeCategory === 'grammar') list = grammarItems;
    else if (activeCategory === 'title_mismatch') list = titleMismatchItems;
    else if (activeCategory === 'style_guide') list = styleGuideItems;

    if (statusFilter === 'pending') {
      return list.filter(r => r.status === 'pending');
    }
    if (statusFilter === 'resolved') {
      return list.filter(r => r.status !== 'pending');
    }
    return list;
  };

  const currentItems = getTabItems();

  // 기사 본문 해당 문단으로 부드러운 스크롤 및 하이라이트 트리거
  const handleScrollToLocation = (blockId: string, reviewId: string, sourceText?: string) => {
    onSelectReview(reviewId);
    if (onFocusBlock) {
      onFocusBlock(blockId, sourceText);
      return;
    }
    const targetElement = document.getElementById(`article-block-${blockId}`) || document.querySelector(`[data-block-id="${blockId}"]`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetElement.classList.add('ring-4', 'ring-blue-400');
      setTimeout(() => {
        targetElement.classList.remove('ring-4', 'ring-blue-400');
      }, 2000);
    }
  };

  return (
    <div id="ai-review-assistant-panel" className="h-full flex flex-col bg-slate-50 select-none text-slate-800">
      {/* 1. Header Bar with Re-scan button */}
      <PanelHeader
        icon={<Sparkles className="w-4 h-4" />}
        title="AI 기사 검수"
        subtitle="기자 원문 중심 보조 검수 (자동 수정 없음)"
        actions={
          <button
            id="btn-run-ai-scan"
            type="button"
            disabled={isScanning || cooldownSeconds > 0}
            onClick={onRunAiScan}
            className={PANEL_BTN_SECONDARY}
            title={cooldownSeconds > 0 ? `재실행 쿨다운 중 (${cooldownSeconds}초)` : '기사 전체 AI 재검토 실행'}
          >
            <RefreshCw className={`w-3 h-3 shrink-0 ${isScanning ? 'animate-spin text-blue-600' : 'text-slate-600'}`} />
            <span>{isScanning ? '분석 중...' : cooldownSeconds > 0 ? `대기 (${cooldownSeconds}s)` : '재검토'}</span>
          </button>
        }
      />

      {/* 2. 4대 검수 카테고리 탭 네비게이션 */}
      <div className="grid grid-cols-4 border-b border-slate-200 bg-white p-1 gap-0.5 text-xs shrink-0">
        {/* 탭 1: 맞춤법·오탈자 */}
        <button
          type="button"
          id="tab-ai-spelling"
          onClick={() => setActiveCategory('spelling')}
          className={`py-2 px-1 text-center rounded transition-all flex flex-col items-center justify-center relative cursor-pointer whitespace-nowrap ${
            activeCategory === 'spelling'
              ? 'bg-slate-100 text-slate-900 font-bold border-b-2 border-amber-600 shadow-2xs'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title="맞춤법 및 오탈자 검수"
        >
          <div className="flex items-center space-x-1 shrink-0">
            <SpellCheck className={`w-3.5 h-3.5 shrink-0 ${activeCategory === 'spelling' ? 'text-amber-600' : 'text-slate-600'}`} />
            <span className="text-[12px] whitespace-nowrap">맞춤법</span>
          </div>
          {pendingCounts.spelling > 0 && (
            <span className="mt-1 px-1.5 py-0.2 rounded-full text-[12px] font-mono font-bold bg-amber-600 text-white shrink-0">
              {pendingCounts.spelling}
            </span>
          )}
        </button>

        {/* 탭 2: 비문·문장 구조 */}
        <button
          type="button"
          id="tab-ai-grammar"
          onClick={() => setActiveCategory('grammar')}
          className={`py-2 px-1 text-center rounded transition-all flex flex-col items-center justify-center relative cursor-pointer whitespace-nowrap ${
            activeCategory === 'grammar'
              ? 'bg-slate-100 text-slate-900 font-bold border-b-2 border-rose-600 shadow-2xs'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title="비문 및 문장 구조 검수 (주어-서술어 일치, 호응 등)"
        >
          <div className="flex items-center space-x-1 shrink-0">
            <AlignLeft className={`w-3.5 h-3.5 shrink-0 ${activeCategory === 'grammar' ? 'text-rose-600' : 'text-slate-600'}`} />
            <span className="text-[12px] whitespace-nowrap">비문·문장</span>
          </div>
          {pendingCounts.grammar > 0 && (
            <span className="mt-1 px-1.5 py-0.2 rounded-full text-[12px] font-mono font-bold bg-rose-600 text-white shrink-0">
              {pendingCounts.grammar}
            </span>
          )}
        </button>

        {/* 탭 3: 제목·본문 비교 */}
        <button
          type="button"
          id="tab-ai-title-mismatch"
          onClick={() => setActiveCategory('title_mismatch')}
          className={`py-2 px-1 text-center rounded transition-all flex flex-col items-center justify-center relative cursor-pointer whitespace-nowrap ${
            activeCategory === 'title_mismatch'
              ? 'bg-slate-100 text-slate-900 font-bold border-b-2 border-indigo-600 shadow-2xs'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title="제목과 본문 내용 대조 (인물/수치 불일치, 단정적 표현)"
        >
          <div className="flex items-center space-x-1 shrink-0">
            <FileSearch className={`w-3.5 h-3.5 shrink-0 ${activeCategory === 'title_mismatch' ? 'text-indigo-600' : 'text-slate-600'}`} />
            <span className="text-[12px] whitespace-nowrap">제목비교</span>
          </div>
          {pendingCounts.title_mismatch > 0 && (
            <span className="mt-1 px-1.5 py-0.2 rounded-full text-[12px] font-mono font-bold bg-indigo-600 text-white shrink-0">
              {pendingCounts.title_mismatch}
            </span>
          )}
        </button>

        {/* 탭 4: 기사 표기법 */}
        <button
          type="button"
          id="tab-ai-style-guide"
          onClick={() => setActiveCategory('style_guide')}
          className={`py-2 px-1 text-center rounded transition-all flex flex-col items-center justify-center relative cursor-pointer whitespace-nowrap ${
            activeCategory === 'style_guide'
              ? 'bg-slate-100 text-slate-900 font-bold border-b-2 border-blue-600 shadow-2xs'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title="기사 작성 표기 가이드 (외래어, 국가명, 직책 등)"
        >
          <div className="flex items-center space-x-1 shrink-0">
            <BookOpen className={`w-3.5 h-3.5 shrink-0 ${activeCategory === 'style_guide' ? 'text-blue-600' : 'text-slate-600'}`} />
            <span className="text-[12px] whitespace-nowrap">표기법</span>
          </div>
          {pendingCounts.style_guide > 0 && (
            <span className="mt-1 px-1.5 py-0.2 rounded-full text-[12px] font-mono font-bold bg-blue-600 text-white shrink-0">
              {pendingCounts.style_guide}
            </span>
          )}
        </button>
      </div>

      {/* 3. Sub-filter: 전체 / 대기중 / 처리완료 */}
      <div className="px-3 py-2 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[12px] shrink-0">
        <span className="text-slate-600 font-medium">검수 항목 ({currentItems.length}건)</span>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2 py-0.5 rounded text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-2 py-0.5 rounded text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === 'pending' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            대기
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`px-2 py-0.5 rounded text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === 'resolved' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            완료
          </button>
        </div>
      </div>

      {/* 4. 검수 카드 목록 영역 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {currentItems.length === 0 ? (
          <div className="text-center py-12 px-4 bg-white rounded-lg border border-slate-200 select-none">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-800">해당 항목 없음</p>
            <p className="text-[12px] text-slate-600 mt-1">
              현재 카테고리에 검토할 문제가 발견되지 않았습니다.
            </p>
          </div>
        ) : (
          currentItems.map((item) => {
            const isSelected = selectedReviewId === item.id;
            const isResolved = item.status === 'resolved';
            const isIgnored = item.status === 'ignored';
            const isPending = item.status === 'pending';
            const suggestion = item.suggestionExample || item.suggestion;

            return (
              <div
                key={item.id}
                id={`ai-review-card-${item.id}`}
                onClick={() => onSelectReview(item.id)}
                className={`p-3.5 rounded-lg border text-xs transition-all bg-white shadow-xs space-y-2.5 ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-100'
                    : isResolved
                    ? 'border-emerald-200 bg-emerald-50/15'
                    : isIgnored
                    ? 'border-slate-200 bg-slate-50/70 opacity-75'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* 1) 카드 상단: 문제 유형 뱃지 & 본문 위치 이동 링크 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                    {/* 세부 문제 유형 뱃지 */}
                    <span className="px-2 py-0.5 rounded text-[12px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                      {item.subCategory || (activeCategory === 'spelling' ? '맞춤법' : activeCategory === 'grammar' ? '비문' : activeCategory === 'title_mismatch' ? '제목대조' : '표기법')}
                    </span>

                    {/* 처리 상태 뱃지 */}
                    {isResolved && (
                      <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-emerald-100 text-emerald-800">
                        확인 완료
                      </span>
                    )}
                    {isIgnored && (
                      <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-slate-200 text-slate-600">
                        무시됨
                      </span>
                    )}
                  </div>

                  {/* 본문 위치 이동 버튼 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScrollToLocation(item.blockId, item.id, item.sourceText);
                    }}
                    className="text-[12px] text-blue-600 hover:text-blue-800 font-medium inline-flex items-center space-x-0.5 cursor-pointer whitespace-nowrap shrink-0"
                    title="기사 본문 해당 문단으로 이동 및 하이라이트"
                  >
                    <span className="whitespace-nowrap">기사에서 위치 보기</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </button>
                </div>

                {/* 2) 카드 본문: 5대 핵심 정보 표시 */}
                <div className="space-y-2">
                  {/* [정보 1] 문제가 있는 원문 */}
                  <div>
                    <div className="text-[12px] font-bold text-slate-600 uppercase tracking-tight">
                      문제 원문
                    </div>
                    <p className="p-2 bg-rose-50/60 rounded border border-rose-200/80 text-rose-950 font-sans text-xs leading-relaxed font-medium break-keep">
                      "{item.sourceText}"
                    </p>
                  </div>

                  {/* [정보 2] 문제가 되는 이유 */}
                  {item.reason && (
                    <div>
                      <div className="text-[12px] font-bold text-amber-700 uppercase tracking-tight">
                        문제 이유
                      </div>
                      <p className="p-2 bg-amber-50/50 rounded border border-amber-200/70 text-amber-950 text-xs leading-relaxed break-keep">
                        {item.reason}
                      </p>
                    </div>
                  )}

                  {/* [정보 3] 확인할 내용 */}
                  {item.checkPoint && (
                    <div>
                      <div className="text-[12px] font-bold text-blue-700 uppercase tracking-tight">
                        확인할 내용
                      </div>
                      <p className="p-2 bg-blue-50/50 rounded border border-blue-200/70 text-blue-950 text-xs leading-relaxed break-keep">
                        {item.checkPoint}
                      </p>
                    </div>
                  )}

                  {/* [정보 4] 수정 예시 (참고용 - 자동 수정 기능 없음) */}
                  {suggestion && (
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[12px] font-bold text-emerald-700 uppercase tracking-tight">
                          수정 예시
                        </span>
                        <span className="text-[12px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                          참고용 (클릭 및 자동 수정 없음)
                        </span>
                      </div>
                      <div className="p-2 bg-emerald-50/60 rounded border border-emerald-200/80 text-emerald-950 text-xs font-semibold font-sans leading-relaxed">
                        "{suggestion}"
                      </div>
                    </div>
                  )}
                </div>

                {/* 3) 액션 버튼: [확인 완료] [무시] / [되돌리기] (원문 자동 수정 버튼 없음!) */}
                {!isPending ? (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[12px] text-slate-600 whitespace-nowrap">
                    <span className="whitespace-nowrap">
                      {isResolved ? '확인 완료 처리됨' : '무시 처리됨 (원문 유지)'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUndoReview(item.id);
                      }}
                      className="text-slate-600 hover:text-slate-900 underline font-medium text-[12px] inline-flex items-center space-x-1 cursor-pointer whitespace-nowrap shrink-0"
                      title="대기 상태로 되돌립니다"
                    >
                      <RotateCcw className="w-3 h-3 shrink-0" />
                      <span className="whitespace-nowrap">되돌리기</span>
                    </button>
                  </div>
                ) : (
                  <div className="pt-1.5 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        id={`btn-resolve-review-${item.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onResolveReview(item.id);
                        }}
                        className="py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        title="해당 사항을 검토 확인했음을 표시합니다"
                      >
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span className="whitespace-nowrap">확인 완료</span>
                      </button>

                      <button
                        type="button"
                        id={`btn-ignore-review-${item.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onIgnoreReview(item.id);
                        }}
                        className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        title="검수 제안을 무시하고 원문을 유지합니다"
                      >
                        <X className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        <span className="whitespace-nowrap">무시</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 5. Footer: 원칙 안내 배너 */}
      <div className="p-3 bg-white border-t border-slate-200 text-[12px] text-slate-600 flex items-center justify-between">
        <div className="flex items-center space-x-1 text-slate-600">
          <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>기자 직접 확인 및 수정 원칙 (자동 수정 없음)</span>
        </div>
        <span className="font-mono text-slate-600">Step 1 UI</span>
      </div>
    </div>
  );
};
