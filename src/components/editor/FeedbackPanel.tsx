import React, { useState, useEffect, useMemo } from 'react';
import { PanelHeader, PANEL_BTN_PRIMARY, PANEL_BTN_SECONDARY } from './PanelHeader';
import { 
  MessageSquare, 
  CheckCircle2, 
  Circle, 
  CornerDownRight, 
  Send, 
  Plus, 
  X, 
  MessageCircle, 
  ExternalLink, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Smile 
} from 'lucide-react';
import { 
  ArticleFeedback, 
  FeedbackReply, 
  ArticleBlock, 
  User, 
  USER_RANK_LABELS, 
  ReactionType, 
  ReactionItem,
  FeedbackColor
} from '../../types';

export const FEEDBACK_CARD_THEMES: Record<FeedbackColor, {
  highlightRing: string;
  badge: string;
  quoteBox: string;
  borderBar: string;
  dot: string;
}> = {
  emerald: {
    highlightRing: 'ring-2 ring-emerald-500 border-emerald-500 shadow-md bg-emerald-50/20',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200',
    quoteBox: 'bg-emerald-50/90 border-l-2 border-emerald-500 text-emerald-950 hover:bg-emerald-100',
    borderBar: 'border-l-4 border-l-emerald-500',
    dot: 'bg-emerald-500',
  },
  amber: {
    highlightRing: 'ring-2 ring-amber-500 border-amber-500 shadow-md bg-amber-50/20',
    badge: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200',
    quoteBox: 'bg-amber-50/90 border-l-2 border-amber-500 text-amber-950 hover:bg-amber-100',
    borderBar: 'border-l-4 border-l-amber-500',
    dot: 'bg-amber-500',
  },
  blue: {
    highlightRing: 'ring-2 ring-blue-500 border-blue-500 shadow-md bg-blue-50/20',
    badge: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200',
    quoteBox: 'bg-blue-50/90 border-l-2 border-blue-500 text-blue-950 hover:bg-blue-100',
    borderBar: 'border-l-4 border-l-blue-500',
    dot: 'bg-blue-500',
  },
  rose: {
    highlightRing: 'ring-2 ring-rose-500 border-rose-500 shadow-md bg-rose-50/20',
    badge: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-200',
    quoteBox: 'bg-rose-50/90 border-l-2 border-rose-500 text-rose-950 hover:bg-rose-100',
    borderBar: 'border-l-4 border-l-rose-500',
    dot: 'bg-rose-500',
  },
  purple: {
    highlightRing: 'ring-2 ring-purple-500 border-purple-500 shadow-md bg-purple-50/20',
    badge: 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200',
    quoteBox: 'bg-purple-50/90 border-l-2 border-purple-500 text-purple-950 hover:bg-purple-100',
    borderBar: 'border-l-4 border-l-purple-500',
    dot: 'bg-purple-500',
  },
};

export const REACTION_EMOJIS: Record<ReactionType, string> = {
  heart: '❤️',
  check: '✅',
  thumbs_up: '👍',
  laugh: '😂',
};

const ALL_REACTION_TYPES: ReactionType[] = ['heart', 'check', 'thumbs_up', 'laugh'];

interface FeedbackPanelProps {
  feedbacks: ArticleFeedback[];
  blocks: ArticleBlock[];
  currentUser: User;
  onAddFeedback: (feedback: Omit<ArticleFeedback, 'id' | 'createdAt' | 'replies'>) => void;
  onAddReply: (feedbackId: string, reply: Omit<FeedbackReply, 'id' | 'createdAt'>) => void;
  onToggleResolve: (feedbackId: string) => void;
  onFocusBlock?: (blockId: string) => void;
  onEditFeedback?: (feedbackId: string, newContent: string) => void;
  onDeleteFeedback?: (feedbackId: string) => void;
  onEditReply?: (feedbackId: string, replyId: string, newContent: string) => void;
  onDeleteReply?: (feedbackId: string, replyId: string) => void;
  onToggleFeedbackReaction?: (feedbackId: string, type: ReactionType) => void;
  onToggleReplyReaction?: (feedbackId: string, replyId: string, type: ReactionType) => void;
  highlightedFeedbackId?: string | null;
  onFocusFeedback?: (feedbackId: string, blockId?: string) => void;
  onClose?: () => void;
}

export const FeedbackPanel: React.FC<FeedbackPanelProps> = ({
  feedbacks,
  blocks,
  currentUser,
  onAddFeedback,
  onAddReply,
  onToggleResolve,
  onFocusBlock,
  onEditFeedback,
  onDeleteFeedback,
  onEditReply,
  onDeleteReply,
  onToggleFeedbackReaction,
  onToggleReplyReaction,
  highlightedFeedbackId,
  onFocusFeedback,
  onClose,
}) => {
  // Local state
  const [filterMode, setFilterMode] = useState<'all' | 'unresolved'>('all');
  const [isComposing, setIsComposing] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  
  // Replying state map: { [feedbackId]: replyText }
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [openReplyBoxId, setOpenReplyBoxId] = useState<string | null>(null);

  // Edit states
  const [editingFeedbackId, setEditingFeedbackId] = useState<string | null>(null);
  const [editFeedbackContent, setEditFeedbackContent] = useState('');

  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyContent, setEditReplyContent] = useState('');

  // Delete confirm states
  const [confirmDeleteFeedbackId, setConfirmDeleteFeedbackId] = useState<string | null>(null);
  const [confirmDeleteReplyId, setConfirmDeleteReplyId] = useState<string | null>(null);

  // Dropdown menu states
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeReactionPickerId, setActiveReactionPickerId] = useState<string | null>(null);

  // Close menus on click outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setActiveMenuId(null);
      setActiveReactionPickerId(null);
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  // Paragraph blocks for selection
  const paragraphBlocks = blocks.map((b, idx) => ({
    id: b.id,
    label: `${idx + 1}문단 (${b.type === 'paragraph' ? (b.text?.slice(0, 16) || '본문') + '...' : b.type})`,
    paragraphIndex: idx + 1,
  }));

  // Article full text for anchor verification
  const fullArticleText = useMemo(() => {
    return blocks
      .filter(b => b.type === 'paragraph' || b.type === 'quote')
      .map(b => b.text || '')
      .join('\n\n');
  }, [blocks]);

  // Filtering
  const filteredFeedbacks = feedbacks.filter((fb) => {
    if (filterMode === 'unresolved') return !fb.isResolved;
    return true;
  });

  const unresolvedCount = feedbacks.filter(f => !f.isResolved).length;

  const handleCreateFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    let paragraphIndex: number | undefined = undefined;
    if (selectedBlockId) {
      const idx = blocks.findIndex(b => b.id === selectedBlockId);
      if (idx !== -1) paragraphIndex = idx + 1;
    }

    onAddFeedback({
      blockId: selectedBlockId || undefined,
      paragraphIndex,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRank: currentUser.rank,
      authorRoleTitle: currentUser.roleTitle,
      content: newContent.trim(),
      isResolved: false,
    });

    setNewContent('');
    setSelectedBlockId('');
    setIsComposing(false);
  };

  const handleSendReply = (feedbackId: string) => {
    const text = replyInputs[feedbackId]?.trim();
    if (!text) return;

    onAddReply(feedbackId, {
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRank: currentUser.rank,
      authorRoleTitle: currentUser.roleTitle,
      content: text,
    });

    setReplyInputs(prev => ({ ...prev, [feedbackId]: '' }));
    setOpenReplyBoxId(null);
  };

  const handleStartEditFeedback = (fb: ArticleFeedback) => {
    setEditingFeedbackId(fb.id);
    setEditFeedbackContent(fb.content);
    setActiveMenuId(null);
  };

  const handleSaveEditFeedback = (feedbackId: string) => {
    if (!editFeedbackContent.trim()) return;
    if (onEditFeedback) {
      onEditFeedback(feedbackId, editFeedbackContent.trim());
    }
    setEditingFeedbackId(null);
    setEditFeedbackContent('');
  };

  const handleStartEditReply = (reply: FeedbackReply) => {
    setEditingReplyId(reply.id);
    setEditReplyContent(reply.content);
    setActiveMenuId(null);
  };

  const handleSaveEditReply = (feedbackId: string, replyId: string) => {
    if (!editReplyContent.trim()) return;
    if (onEditReply) {
      onEditReply(feedbackId, replyId, editReplyContent.trim());
    }
    setEditingReplyId(null);
    setEditReplyContent('');
  };

  const renderReactionBadges = (
    reactions: ReactionItem[] | undefined,
    onToggle: (type: ReactionType) => void,
    pickerTargetId: string
  ) => {
    const items = reactions || [];
    const isPickerOpen = activeReactionPickerId === pickerTargetId;

    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5" onClick={(e) => e.stopPropagation()}>
        {items.map((r) => {
          const count = r.userIds.length;
          if (count === 0) return null;
          const isUserReacted = r.userIds.includes(currentUser.id);

          return (
            <button
              key={r.type}
              type="button"
              onClick={() => onToggle(r.type)}
              className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[12px] font-semibold transition-all border ${
                isUserReacted
                  ? 'bg-blue-50 text-blue-800 border-blue-300 font-bold shadow-2xs'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={isUserReacted ? '리액션 취소' : '리액션 추가'}
            >
              <span>{REACTION_EMOJIS[r.type]}</span>
              <span className="font-mono text-[12px]">{count}</span>
            </button>
          );
        })}

        {/* Add reaction '+' button */}
        <div className="relative inline-block">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveReactionPickerId(isPickerOpen ? null : pickerTargetId);
            }}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs border border-slate-200 transition-colors"
            title="리액션 추가"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>

          {/* Reaction Picker Popover */}
          {isPickerOpen && (
            <div 
              className="absolute left-0 bottom-full mb-1 z-30 flex items-center space-x-1 p-1 bg-white border border-slate-200 rounded-full shadow-lg animate-in fade-in duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {ALL_REACTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onToggle(type);
                    setActiveReactionPickerId(null);
                  }}
                  className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded-full text-base transition-transform hover:scale-110"
                >
                  {REACTION_EMOJIS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div 
      id="feedback-panel"
      className="h-full flex flex-col bg-slate-50 select-none text-slate-700"
    >
      {/* 1. Header */}
      <PanelHeader
        icon={<MessageSquare className="w-4 h-4" />}
        title="데스크 피드백"
        subtitle="기사 첨삭과 문단별 협업 메모"
        badge={unresolvedCount > 0 ? (
          <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
            미해결 {unresolvedCount}
          </span>
        ) : undefined}
        actions={
          <button
            type="button"
            id="btn-compose-feedback"
            onClick={() => setIsComposing(!isComposing)}
            className={isComposing ? PANEL_BTN_SECONDARY : PANEL_BTN_PRIMARY}
          >
            {isComposing ? (<><X className="w-3 h-3 shrink-0" /><span>취소</span></>) : (<><Plus className="w-3 h-3 shrink-0" /><span>메모 추가</span></>)}
          </button>
        }
      />

      {/* 2. Filter Bar */}
      <div className="px-3 py-1.5 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-2 py-0.5 rounded text-[12px] font-semibold transition-colors ${
              filterMode === 'all'
                ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            전체 ({feedbacks.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('unresolved')}
            className={`px-2 py-0.5 rounded text-[12px] font-semibold transition-colors ${
              filterMode === 'unresolved'
                ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            미해결만 ({unresolvedCount})
          </button>
        </div>

        <span className="text-[12px] text-slate-500">
          작성자: {currentUser.name} ({currentUser.roleTitle || currentUser.rank})
        </span>
      </div>

      {/* 3. New Feedback Composer Drawer / Form */}
      {isComposing && (
        <form 
          onSubmit={handleCreateFeedback}
          className="p-3 bg-blue-50/40 border-b border-blue-200 shrink-0 space-y-2 animate-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-800 flex items-center space-x-1">
              <MessageCircle className="w-3.5 h-3.5 text-blue-600" />
              <span>새 피드백 / 메모 작성</span>
            </span>

            <select
              id="select-feedback-paragraph"
              value={selectedBlockId}
              onChange={(e) => setSelectedBlockId(e.target.value)}
              className="text-[12px] bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 font-sans"
            >
              <option value="">전체 기사 대상 메모</option>
              {paragraphBlocks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <textarea
            id="textarea-feedback-content"
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="데스크 피드백 또는 기사 보완 메모를 입력하세요 (예: 3문단 통계 출처 보강 필요 등)..."
            className="w-full p-2 bg-white border border-slate-300 rounded text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 font-sans resize-none"
            autoFocus
          />

          <div className="flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={() => setIsComposing(false)}
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!newContent.trim()}
              className="px-3 py-1 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded transition-colors flex items-center space-x-1"
            >
              <Send className="w-3 h-3" />
              <span>메모 등록</span>
            </button>
          </div>
        </form>
      )}

      {/* 4. Feedback List */}
      <div 
        id="feedback-list-container"
        className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50"
      >
        {filteredFeedbacks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500">
            <MessageSquare className="w-8 h-8 mb-2 text-slate-300" />
            <p className="text-xs font-bold text-slate-700">
              {filterMode === 'unresolved' ? '미해결된 피드백 메모가 없습니다' : '등록된 피드백 메모가 없습니다'}
            </p>
            <p className="text-[12px] text-slate-600 mt-1 max-w-xs">
              데스크 지시사항이나 동료 기자 간 검토 의견을 상단 "+ 메모 추가" 버튼으로 남길 수 있습니다.
            </p>
          </div>
        ) : (
          filteredFeedbacks.map((fb) => {
            const isResolved = fb.isResolved ?? false;
            const isReplying = openReplyBoxId === fb.id;
            const replyText = replyInputs[fb.id] || '';
            const isMyFeedback = fb.authorId ? fb.authorId === currentUser.id : false;
            const isEditingThis = editingFeedbackId === fb.id;
            const isDeletingThis = confirmDeleteFeedbackId === fb.id;
            const isMenuOpen = activeMenuId === `fb_${fb.id}`;

            const hasSelectedText = Boolean(fb.selectedText && fb.selectedText.trim().length > 0);
            const isAnchorMissing = hasSelectedText ? !fullArticleText.includes(fb.selectedText!.trim()) : false;
            const isCurrentHighlighted = highlightedFeedbackId === fb.id;
            const cardTheme = FEEDBACK_CARD_THEMES[(fb.color as FeedbackColor) || 'emerald'];

            return (
              <div
                key={fb.id}
                id={`feedback-card-${fb.id}`}
                className={`bg-white rounded border transition-all ${cardTheme.borderBar} ${
                  isCurrentHighlighted
                    ? cardTheme.highlightRing
                    : isResolved 
                      ? 'border-slate-200 bg-slate-50/60 opacity-85' 
                      : 'border-slate-300 shadow-2xs hover:border-slate-400'
                }`}
              >
                {/* Card Header */}
                <div className="p-3 border-b border-slate-100 flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      {/* Author badge */}
                      <span className="font-bold text-xs text-slate-900">
                        {fb.authorName}
                      </span>
                      
                      {/* Rank & Role title */}
                      <span className="px-1.5 py-0.2 rounded text-[12px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {fb.authorRoleTitle || USER_RANK_LABELS[fb.authorRank] || fb.authorRank}
                      </span>

                      {/* Text drag feedback anchor badge */}
                      {hasSelectedText ? (
                        isAnchorMissing ? (
                          <span 
                            className="px-1.5 py-0.2 rounded text-[12px] font-medium bg-amber-50 text-amber-800 border border-amber-300"
                            title="본문이 수정 또는 삭제되어 원문 위치를 찾을 수 없습니다"
                          >
                            ⚠️ 연결된 원문 위치를 찾을 수 없음
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const anchorEl = document.getElementById(`feedback-anchor-${fb.id}`);
                              if (anchorEl) {
                                anchorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                              if (onFocusFeedback) onFocusFeedback(fb.id, fb.blockId);
                            }}
                            className={`px-1.5 py-0.2 rounded text-[12px] font-bold border transition-colors flex items-center space-x-0.5 cursor-pointer whitespace-nowrap ${cardTheme.badge}`}
                            title="선택한 원문 글자 위치로 바로 이동합니다"
                          >
                            <span>원문 이동</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        )
                      ) : fb.paragraphIndex ? (
                        <button
                          type="button"
                          onClick={() => fb.blockId && onFocusBlock && onFocusBlock(fb.blockId)}
                          className="px-1.5 py-0.2 rounded text-[12px] font-bold bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 transition-colors flex items-center space-x-0.5 cursor-pointer"
                          title="해당 문단으로 이동 및 강조"
                        >
                          <span>#{String(fb.paragraphIndex).padStart(2, '0')} 문단</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      ) : null}

                      <span className="text-[12px] text-slate-500 font-mono">
                        {fb.createdAt}
                      </span>
                    </div>
                  </div>

                  {/* Header Actions: Resolve Button + More Menu(...) */}
                  <div className="flex items-center space-x-1 shrink-0">
                    {/* Resolve Checkbox / Toggle */}
                    <button
                      type="button"
                      onClick={() => onToggleResolve(fb.id)}
                      className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[12px] font-semibold transition-colors border ${
                        isResolved
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                          : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                      title={isResolved ? '해결 완료 취소' : '해결 완료 처리'}
                    >
                      {isResolved ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
                          <span>해결됨</span>
                        </>
                      ) : (
                        <>
                          <Circle className="w-3.5 h-3.5 text-slate-500" />
                          <span>미해결</span>
                        </>
                      )}
                    </button>

                    {/* Author Only More Menu (...) */}
                    {isMyFeedback && (
                      <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          id={`btn-feedback-more-${fb.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(isMenuOpen ? null : `fb_${fb.id}`);
                          }}
                          className="p-1 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                          title="피드백 관리"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>

                        {isMenuOpen && (
                          <div className="absolute right-0 top-full mt-1 z-20 w-24 bg-white border border-slate-200 rounded-md shadow-lg py-1 text-xs animate-in fade-in duration-100">
                            <button
                              type="button"
                              onClick={() => handleStartEditFeedback(fb)}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center space-x-1.5 text-slate-700"
                            >
                              <Edit2 className="w-3 h-3 text-slate-600" />
                              <span>수정</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteFeedbackId(fb.id);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-rose-50 flex items-center space-x-1.5 text-rose-600"
                            >
                              <Trash2 className="w-3 h-3 text-rose-500" />
                              <span>삭제</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Delete Confirmation Box */}
                {isDeletingThis && (
                  <div className="p-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between text-xs text-rose-900 animate-in fade-in">
                    <span className="font-semibold">이 피드백을 삭제하시겠습니까?</span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFeedbackId(null)}
                        className="px-2 py-0.5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-100"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (onDeleteFeedback) onDeleteFeedback(fb.id);
                          setConfirmDeleteFeedbackId(null);
                        }}
                        className="px-2 py-0.5 bg-rose-600 text-white rounded font-bold hover:bg-rose-700"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}

                {/* Selected Text Preview Quote */}
                {hasSelectedText && (
                  <div
                    onClick={() => {
                      if (!isAnchorMissing) {
                        const anchorEl = document.getElementById(`feedback-anchor-${fb.id}`);
                        if (anchorEl) {
                          anchorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        if (onFocusFeedback) onFocusFeedback(fb.id, fb.blockId);
                      }
                    }}
                    className={`mx-3 mt-2.5 p-2 rounded text-xs transition-colors flex items-start space-x-1.5 ${
                      isAnchorMissing
                        ? 'bg-slate-100 border-l-2 border-slate-300 text-slate-600 cursor-default'
                        : `${cardTheme.quoteBox} cursor-pointer`
                    }`}
                    title={isAnchorMissing ? '원문 위치를 찾을 수 없음' : '클릭 시 기사 내 해당 원문으로 이동'}
                  >
                    <span className="text-emerald-700 font-bold shrink-0">“</span>
                    <span className="flex-1 line-clamp-2 select-text font-serif italic text-emerald-900">
                      {fb.selectedText}
                    </span>
                    <span className="text-emerald-700 font-bold shrink-0">”</span>
                  </div>
                )}

                {/* Card Body: Content (or Inline Edit Form) */}
                {isEditingThis ? (
                  <div className="p-3 space-y-2 bg-slate-50 border-b border-slate-200">
                    <textarea
                      rows={3}
                      value={editFeedbackContent}
                      onChange={(e) => setEditFeedbackContent(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 font-sans resize-none"
                      autoFocus
                    />
                    <div className="flex items-center justify-end space-x-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingFeedbackId(null)}
                        className="px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEditFeedback(fb.id)}
                        disabled={!editFeedbackContent.trim()}
                        className="px-3 py-1 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 text-xs text-slate-800 font-sans leading-relaxed whitespace-pre-wrap select-text break-keep">
                    {fb.content}
                  </div>
                )}

                {/* Reaction Bar */}
                <div className="px-3 pb-2.5">
                  {renderReactionBadges(
                    fb.reactions,
                    (type) => onToggleFeedbackReaction && onToggleFeedbackReaction(fb.id, type),
                    `fb_${fb.id}`
                  )}
                </div>

                {/* Replies Section */}
                <div className="bg-slate-50/80 border-t border-slate-100 p-2.5 space-y-2">
                  {fb.replies && fb.replies.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {fb.replies.map((reply) => {
                        const isMyReply = reply.authorId ? reply.authorId === currentUser.id : false;
                        const isEditingThisReply = editingReplyId === reply.id;
                        const isDeletingThisReply = confirmDeleteReplyId === reply.id;
                        const isReplyMenuOpen = activeMenuId === `rep_${reply.id}`;

                        return (
                          <div 
                            key={reply.id}
                            className="bg-white p-2 rounded border border-slate-200 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between text-[12px]">
                              <div className="flex items-center space-x-1 font-bold text-slate-800">
                                <CornerDownRight className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>{reply.authorName}</span>
                                <span className="font-normal text-slate-600">
                                  ({reply.authorRoleTitle || USER_RANK_LABELS[reply.authorRank] || reply.authorRank})
                                </span>
                              </div>

                              <div className="flex items-center space-x-1.5">
                                <span className="text-slate-500 font-mono">
                                  {reply.createdAt}
                                </span>

                                {/* Reply More Menu (...) for Author Only */}
                                {isMyReply && (
                                  <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveMenuId(isReplyMenuOpen ? null : `rep_${reply.id}`);
                                      }}
                                      className="p-0.5 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                      title="답글 관리"
                                    >
                                      <MoreVertical className="w-3 h-3" />
                                    </button>

                                    {isReplyMenuOpen && (
                                      <div className="absolute right-0 top-full mt-1 z-20 w-20 bg-white border border-slate-200 rounded-md shadow-lg py-1 text-[12px] animate-in fade-in duration-100">
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditReply(reply)}
                                          className="w-full text-left px-2.5 py-1 hover:bg-slate-100 flex items-center space-x-1 text-slate-700"
                                        >
                                          <Edit2 className="w-2.5 h-2.5 text-slate-600" />
                                          <span>수정</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmDeleteReplyId(reply.id);
                                            setActiveMenuId(null);
                                          }}
                                          className="w-full text-left px-2.5 py-1 hover:bg-rose-50 flex items-center space-x-1 text-rose-600"
                                        >
                                          <Trash2 className="w-2.5 h-2.5 text-rose-500" />
                                          <span>삭제</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Reply Delete Confirmation */}
                            {isDeletingThisReply && (
                              <div className="p-2 bg-rose-50 border border-rose-200 rounded flex items-center justify-between text-[12px] text-rose-900">
                                <span>이 답글을 삭제하시겠습니까?</span>
                                <div className="flex items-center space-x-1">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteReplyId(null)}
                                    className="px-2 py-0.5 bg-white border border-slate-300 rounded text-slate-600"
                                  >
                                    취소
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onDeleteReply) onDeleteReply(fb.id, reply.id);
                                      setConfirmDeleteReplyId(null);
                                    }}
                                    className="px-2 py-0.5 bg-rose-600 text-white rounded font-bold"
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Reply Content or Edit Form */}
                            {isEditingThisReply ? (
                              <div className="space-y-1.5 pt-1">
                                <textarea
                                  rows={2}
                                  value={editReplyContent}
                                  onChange={(e) => setEditReplyContent(e.target.value)}
                                  className="w-full p-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 font-sans resize-none"
                                  autoFocus
                                />
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingReplyId(null)}
                                    className="px-2 py-0.5 text-[12px] text-slate-600 bg-white border border-slate-300 rounded"
                                  >
                                    취소
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditReply(fb.id, reply.id)}
                                    disabled={!editReplyContent.trim()}
                                    className="px-2.5 py-0.5 text-[12px] font-bold text-white bg-slate-900 rounded"
                                  >
                                    저장
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-slate-800 pl-4 text-[12px] leading-relaxed select-text break-keep">
                                {reply.content}
                              </p>
                            )}

                            {/* Reply Reactions */}
                            <div className="pl-4">
                              {renderReactionBadges(
                                reply.reactions,
                                (type) => onToggleReplyReaction && onToggleReplyReaction(fb.id, reply.id, type),
                                `rep_${reply.id}`
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reply Button or Inline Composer */}
                  {isReplying ? (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center space-x-1 text-[12px] text-slate-600 font-medium">
                        <CornerDownRight className="w-3 h-3 text-slate-500" />
                        <span>{currentUser.name} ({currentUser.roleTitle || USER_RANK_LABELS[currentUser.rank]}) 답글 작성</span>
                      </div>
                      <textarea
                        rows={2}
                        value={replyText}
                        onChange={(e) => setReplyInputs(prev => ({ ...prev, [fb.id]: e.target.value }))}
                        placeholder="답글 내용을 입력하세요..."
                        className="w-full p-2 bg-white border border-slate-300 rounded text-xs text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none font-sans"
                        autoFocus
                      />
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenReplyBoxId(null)}
                          className="px-2 py-0.5 text-[12px] text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendReply(fb.id)}
                          disabled={!replyText.trim()}
                          className="px-2.5 py-0.5 text-[12px] font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded flex items-center space-x-1"
                        >
                          <Send className="w-2.5 h-2.5" />
                          <span>답글 등록</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenReplyBoxId(fb.id)}
                      className="text-[12px] font-semibold text-slate-600 hover:text-slate-900 flex items-center space-x-1 py-0.5 transition-colors cursor-pointer"
                    >
                      <CornerDownRight className="w-3 h-3 text-slate-500" />
                      <span>답글 작성</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
