import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Image as ImageIcon, 
  Video, 
  AlertCircle,
  Tag,
  X,
  MessageSquare,
  Send,
  Calendar,
  Clock,
  UserCheck,
  History,
  UploadCloud
} from 'lucide-react';
import { Article, ArticleBlock, ArticleFeedback, ArticleStatus, MediaItem, User, SaveStatus, ProjectVisibility } from '../../types';
import { EditorTopBar } from './EditorTopBar';
import { MediaPickerModal } from './MediaPickerModal';
import { TxtImportModal } from './TxtImportModal';
import { AssignArticleModal } from '../dashboard/AssignArticleModal';
import { BodyEditor } from './BodyEditor';
import { buildDocx } from './docxExport';
import { parseCrop, cropSourceRect } from '../common/mediaCrop';
import type { CropFocus } from '../common/mediaCrop';
import type { BodyEditorControls, BodyTextSelection } from './BodyEditor';
import type { BodyBlockDraft } from './bodyEditorModel';
import { HIGHLIGHTER_STYLES } from './feedbackHighlight';
import type { HighlighterColor } from './feedbackHighlight';

interface ArticleEditorProps {
  article: Article;
  onUpdateArticle: (updated: Article) => void;
  onOpenMediaDrawer: () => void;
  onInsertMediaAt: (media: MediaItem, index: number) => void;
  saveStatus?: SaveStatus;
  lastSavedTime?: string;
  onManualSave?: () => void;
  mediaLibrary?: MediaItem[];
  isRightPanelOpen?: boolean;
  onOpenFeedback?: () => void;
  onOpenAuditLogs?: () => void;
  onRunAiScan?: () => void;
  unresolvedFeedbackCount?: number;
  unresolvedAiCount?: number;
  highlightedBlockId?: string | null;
  highlightedText?: string | null;
  onToggleShare?: () => void;
  onSelectVisibility?: (visibility: ProjectVisibility) => void;
  /** 새 본문 편집기(시험 중): 편집기 내용을 저장하고 실제 블록 ID 목록을 돌려준다 */
  onSaveBodyDrafts?: (drafts: BodyBlockDraft[], articleId: string) => Promise<string[]>;
  /** 새 본문 편집기의 "지금 저장 / 변경 버리기" 조작 함수를 App에 등록 */
  onRegisterBodyControls?: (controls: BodyEditorControls | null) => void;
  /** 새 본문 편집기가 켜졌는지 App에 알림 (켜져 있는 동안 기존 방식 사진 삽입 등을 막기 위함) */
  onBodyEditorActiveChange?: (active: boolean) => void;
  /** 최신 기사를 다시 불러올 때마다 바뀌는 번호 (새 편집기를 새로 시작하기 위함) */
  bodyEditorEpoch?: number;
  onUploadAndInsertMedia?: (files: File[], targetIndex?: number) => Promise<void>;
  isManagerReviewMode?: boolean;
  onImportTxtBlocks?: (paragraphs: string[], mode: 'append' | 'replace') => Promise<void>;
  feedbacks?: ArticleFeedback[];
  highlightedFeedbackId?: string | null;
  onAddFeedback?: (feedback: Omit<ArticleFeedback, 'id' | 'createdAt' | 'replies'>) => void;
  currentUser?: User;
  onRequestReview?: () => void;
  onRequestChanges?: () => void;
  onApproveArticle?: () => void;
  isDesk?: boolean;
  isAuthor?: boolean;
  isWorkflowLoading?: boolean;
  onToggleAiTools?: () => void;
  isAiToolsOpen?: boolean;
  onChangeStatus?: (status: ArticleStatus) => void;
}

// 피드백 앵커 매칭·형광펜 색 정의는 ./feedbackHighlight 로 옮겼습니다 (새 본문 편집기와 공용)
export type { HighlighterColor } from './feedbackHighlight';


export const ArticleEditor: React.FC<ArticleEditorProps> = ({
  article,
  onUpdateArticle,
  onOpenMediaDrawer,
  onInsertMediaAt,
  saveStatus = 'saved',
  lastSavedTime = article.lastSaved,
  onManualSave,
  mediaLibrary = [],
  onOpenFeedback,
  onOpenAuditLogs,
  unresolvedFeedbackCount,
  unresolvedAiCount,
  highlightedBlockId = null,
  highlightedText = null,
  onToggleShare,
  onSelectVisibility,
  onSaveBodyDrafts,
  onRegisterBodyControls,
  onBodyEditorActiveChange,
  bodyEditorEpoch,
  onUploadAndInsertMedia,
  isManagerReviewMode = false,
  onImportTxtBlocks,
  feedbacks = [],
  highlightedFeedbackId = null,
  onAddFeedback,
  currentUser,
  onRequestReview,
  onRequestChanges,
  onApproveArticle,
  isDesk = false,
  isAuthor = true,
  isWorkflowLoading = false,
  onToggleAiTools,
  isAiToolsOpen,
  onChangeStatus,
}) => {
  // 기사가 검토중(review), 출고대기(ready), 출고완료(published)이거나 매니저 검토 모드인 경우 읽기 전용으로 편집 차단
  const isReadOnlyMode = Boolean(
    isManagerReviewMode || 
    article.status === 'review' || 
    article.status === 'ready' || 
    article.status === 'published'
  );

  const [newTagInput, setNewTagInput] = useState('');
  const [isTxtModalOpen, setIsTxtModalOpen] = useState(false);
  
  // 외부 이미지 파일 드래그 앤 드롭 오버레이 상태
  const [isDraggingExternalFiles, setIsDraggingExternalFiles] = useState(false);
  const dragCounterRef = useRef(0);

  // 기사 배정 및 마감 설정 모달 (데스크 권한)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // 마감 시간 및 임박/초과 상태 계산
  const { deadlineFormatted, isDeadlineOverdue, isDeadlineUrgent } = useMemo(() => {
    if (!article.deadlineAt) {
      return { deadlineFormatted: null, isDeadlineOverdue: false, isDeadlineUrgent: false };
    }
    const d = new Date(article.deadlineAt);
    const now = Date.now();
    const diff = d.getTime() - now;
    const isOverdue = diff < 0 && article.status !== 'published';
    const isUrgent = diff >= 0 && diff <= 24 * 60 * 60 * 1000 && article.status !== 'published';
    const formatted = d.toLocaleString('ko-KR', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { deadlineFormatted: formatted, isDeadlineOverdue: isOverdue, isDeadlineUrgent: isUrgent };
  }, [article.deadlineAt, article.status]);

  const bodyControlsLocalRef = useRef<BodyEditorControls | null>(null);

  // 새 편집기 조작 함수를 내부(스위치 전환 시 저장)와 App(수동 저장 등) 양쪽에 등록
  const handleRegisterBodyControls = useCallback((controls: BodyEditorControls | null) => {
    bodyControlsLocalRef.current = controls;
    onRegisterBodyControls?.(controls);
  }, [onRegisterBodyControls]);

  // 새 편집기가 켜져 있는지 App에 알림
  useEffect(() => {
    onBodyEditorActiveChange?.(true);
    return () => onBodyEditorActiveChange?.(false);
  }, [onBodyEditorActiveChange]);


  // 텍스트 드래그 피드백 플로팅 툴팁 및 팝오버 상태
  const [selectionPopover, setSelectionPopover] = useState<{
    isOpen: boolean;
    sectionKey: string;
    selectedText: string;
    startOffset: number;
    endOffset: number;
    contextBefore: string;
    contextAfter: string;
    blockId?: string;
    coords: { x: number; y: number };
    isComposing: boolean;
  }>({
    isOpen: false,
    sectionKey: '',
    selectedText: '',
    startOffset: 0,
    endOffset: 0,
    contextBefore: '',
    contextAfter: '',
    coords: { x: 0, y: 0 },
    isComposing: false,
  });

  const [feedbackMemoInput, setFeedbackMemoInput] = useState('');
  const [feedbackMemoColor, setFeedbackMemoColor] = useState<HighlighterColor>('emerald');

  // 미디어 피커 모달 상태
  const [mediaPickerConfig, setMediaPickerConfig] = useState<{
    isOpen: boolean;
    type: 'image' | 'video';
    targetIndex: number;
  }>({
    isOpen: false,
    type: 'image',
    targetIndex: 0,
  });

  
  const titleInputRef = useRef<HTMLInputElement>(null);






  // highlightedFeedbackId 변경 시 해당 형광펜 앵커 위치로 부드럽게 스크롤
  useEffect(() => {
    if (!highlightedFeedbackId) return;
    const targetElement = document.getElementById(`feedback-anchor-${highlightedFeedbackId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedFeedbackId]);

  // 글자 수 계산
  const calculateCharCount = (blocks: ArticleBlock[], title: string, subtitle?: string) => {
    let count = 0;
    count += title.length;
    count += (subtitle || '').length;
    blocks.forEach(b => {
      if ((b.type === 'paragraph' || b.type === 'quote') && b.text) {
        count += b.text.length;
      }
    });
    return count;
  };

  // Status Change (모든 상태 사이를 자유롭게 양방향 전환 가능)
  const handleStatusChange = (newStatus: ArticleStatus) => {
    if (onChangeStatus) {
      onChangeStatus(newStatus);
    } else {
      onUpdateArticle({
        ...article,
        status: newStatus,
      });
    }
  };

  // Update Title
  const handleTitleChange = (newTitle: string) => {
    if (isReadOnlyMode) return;
    onUpdateArticle({
      ...article,
      title: newTitle,
      charCount: calculateCharCount(article.blocks, newTitle, article.subtitle),
    });
  };

  // Update Subtitle
  const handleSubtitleChange = (newSubtitle: string) => {
    if (isReadOnlyMode) return;
    onUpdateArticle({
      ...article,
      subtitle: newSubtitle,
      charCount: calculateCharCount(article.blocks, article.title, newSubtitle),
    });
  };

  // Update Category
  const handleCategoryChange = (category: string) => {
    if (isReadOnlyMode) return;
    onUpdateArticle({
      ...article,
      category,
    });
  };

  // Add Tag
  const handleAddTag = () => {
    if (isReadOnlyMode) return;
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    const currentTags = article.tags || [];
    if (!currentTags.includes(trimmed)) {
      onUpdateArticle({
        ...article,
        tags: [...currentTags, trimmed],
      });
    }
    setNewTagInput('');
  };

  // Remove Tag
  const handleRemoveTag = (tagToRemove: string) => {
    if (isReadOnlyMode) return;
    const currentTags = article.tags || [];
    onUpdateArticle({
      ...article,
      tags: currentTags.filter(t => t !== tagToRemove),
    });
  };





  // 새 본문 편집기에서 글을 드래그해 선택했을 때 → [피드백 작성] 버튼 띄우기
  const handleBodyTextSelected = (info: BodyTextSelection) => {
    // 아직 DB에 저장되지 않은 임시 칸이면 칸 번호 없이 글귀와 앞뒤 문맥으로만 위치를 기억한다
    const realId = info.blockId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(info.blockId) ? info.blockId : undefined;
    setSelectionPopover({
      isOpen: true,
      sectionKey: '',
      selectedText: info.selectedText,
      startOffset: info.startOffset,
      endOffset: info.endOffset,
      contextBefore: info.contextBefore,
      contextAfter: info.contextAfter,
      blockId: realId,
      coords: {
        x: Math.min(window.innerWidth - 220, Math.max(20, info.clientX - 60)),
        y: Math.max(10, info.clientY - 48),
      },
      isComposing: false,
    });
  };

  const handleBodySelectionCollapsed = () => {
    setSelectionPopover(prev => (prev.isOpen && !prev.isComposing ? { ...prev, isOpen: false } : prev));
  };

  const handleOpenComposeFeedback = () => {
    setFeedbackMemoInput('');
    setSelectionPopover(prev => ({ ...prev, isComposing: true }));
  };

  const handleSubmitDragFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMemoInput.trim() || !onAddFeedback) return;

    onAddFeedback({
      blockId: selectionPopover.blockId,
      selectedText: selectionPopover.selectedText,
      contextBefore: selectionPopover.contextBefore,
      contextAfter: selectionPopover.contextAfter,
      startOffset: selectionPopover.startOffset,
      endOffset: selectionPopover.endOffset,
      content: feedbackMemoInput.trim(),
      authorId: currentUser?.id,
      authorName: currentUser?.name || article.reporter || '기자',
      authorRank: currentUser?.rank || 'reporter',
      authorRoleTitle: currentUser?.roleTitle,
      isResolved: false,
      color: feedbackMemoColor,
    });

    setSelectionPopover(prev => ({ ...prev, isOpen: false, isComposing: false }));
    setFeedbackMemoInput('');
    setFeedbackMemoColor('emerald');
    if (onOpenFeedback) onOpenFeedback();
  };

  // ==========================================
  // 6. 미디어 블록 이동 및 외부 이미지 파일 Drag & Drop 처리
  // ==========================================
  const handleContainerDragEnter = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingExternalFiles(true);
    }
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDraggingExternalFiles) {
        setIsDraggingExternalFiles(true);
      }
    }
  };

  const handleContainerDragLeave = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDraggingExternalFiles(false);
      }
    }
  };

  const handleDropExternalFiles = async (e: React.DragEvent, targetIndex?: number) => {
    if (isReadOnlyMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingExternalFiles(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));

      if (imageFiles.length > 0 && onUploadAndInsertMedia) {
        const targetPos = targetIndex !== undefined ? targetIndex : article.blocks.length;
        await onUploadAndInsertMedia(imageFiles, targetPos);
      }
    }
  };





  // 미디어 삽입 모달 열기
  const handleOpenMediaPicker = (type: 'image' | 'video', targetIndex: number) => {
    if (isManagerReviewMode) return;
    setMediaPickerConfig({
      isOpen: true,
      type,
      targetIndex,
    });
  };

  // Export TXT
  const handleExportTxt = () => {
    let content = `[제목] ${article.title}\n`;
    if (article.subtitle) content += `[부제목] ${article.subtitle}\n`;
    content += `[작성자] ${article.reporter} (${article.desk})\n`;
    content += `[작성일시] ${article.lastSaved || new Date().toLocaleString()}\n`;
    content += `\n------------------------------------------\n\n`;

    article.blocks.forEach(b => {
      if (b.type === 'paragraph' && b.text) {
        content += `${b.text}\n\n`;
      } else if (b.type === 'image') {
        content += `[보도사진] ${b.caption || '(설명 없음)'} (출처: ${b.credit || '본사 DB'})\n\n`;
      } else if (b.type === 'video') {
        content += `[보도영상] ${b.caption || '(영상 클립)'} (출처: ${b.credit || '본사 DB'})\n\n`;
      } else if (b.type === 'quote' && b.text) {
        content += `> "${b.text}" — ${b.caption || ''}\n\n`;
      }
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${article.title.slice(0, 30).replace(/[/\\?%*:|"<>]/g, '_') || '기사'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Word (.docx) — 사진도 파일 안에 함께 담는다
  const handleExportWord = async () => {
    const loadImage = async (url: string, crop?: CropFocus | null) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const nw = bitmap.width;
      const nh = bitmap.height;
      let mime = blob.type || 'image/jpeg';
      let bytes = new Uint8Array(await blob.arrayBuffer());
      let width = nw;
      let height = nh;
      const needsConvert = !/^image\/(png|jpe?g|gif|bmp)$/i.test(mime);
      if (crop || needsConvert) {
        // 편집기에서 자른 대로 잘라 담거나, 워드가 읽기 어려운 형식(webp 등)은 png로 바꿔서 담는다
        const rect = crop ? cropSourceRect(nw, nh, crop) : { sx: 0, sy: 0, sw: nw, sh: nh };
        const scale = Math.min(1, 2000 / rect.sw);
        width = Math.max(1, Math.round(rect.sw * scale));
        height = Math.max(1, Math.round(rect.sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
        const out: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (out) {
          bytes = new Uint8Array(await out.arrayBuffer());
          mime = 'image/png';
        }
      }
      bitmap.close();
      return { bytes, mime, width, height };
    };

    try {
      const data = await buildDocx(
        {
          title: article.title,
          subtitle: article.subtitle,
          byline: `${article.reporter} 기자 (${article.desk}) | 작성일: ${article.lastSaved || new Date().toLocaleString()}`,
          blocks: article.blocks.map(b => ({
            id: b.id,
            type: b.type as 'paragraph' | 'image' | 'video' | 'quote',
            text: b.type === 'image' || b.type === 'video' ? undefined : b.text,
            caption: b.caption,
            credit: b.credit,
            imageUrl: b.type === 'image' ? (b.runtimeMediaUrl || b.mediaUrl || undefined) : undefined,
            crop: b.type === 'image' ? parseCrop(b.text) : null,
          })),
        },
        loadImage
      );
      const blob = new Blob([data as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${article.title.slice(0, 30).replace(/[/\\?%*:|"<>]/g, '_') || '기사'}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ArticleEditor] 워드 내보내기 실패:', err);
      window.alert('워드 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/70 overflow-hidden font-sans">
      {/* 1. 최상단 에디터 툴바 */}
      <EditorTopBar
        article={article}
        onStatusChange={handleStatusChange}
        onToggleShare={onToggleShare}
        onSelectVisibility={onSelectVisibility}
        saveStatus={saveStatus}
        lastSavedTime={lastSavedTime}
        onManualSave={onManualSave}
        onExportTxt={handleExportTxt}
        onExportDoc={handleExportWord}
        onOpenTxtImport={!isManagerReviewMode && onImportTxtBlocks ? () => setIsTxtModalOpen(true) : undefined}
        onOpenMediaDrawer={onOpenMediaDrawer}
        unresolvedFeedbackCount={unresolvedFeedbackCount}
        unresolvedAiCount={unresolvedAiCount}
        isManagerReviewMode={isManagerReviewMode}
        onRequestReview={onRequestReview}
        onRequestChanges={onRequestChanges}
        onApproveArticle={onApproveArticle}
        isDesk={isDesk}
        isAuthor={isAuthor}
        isWorkflowLoading={isWorkflowLoading}
        onToggleAiTools={onToggleAiTools}
        isAiToolsOpen={isAiToolsOpen}
      />

      {/* 2. 메인 기사 편집 캔버스 (단일 연속 문서 뷰 - 흰색 페이지 무한 확장 보장) */}
      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-12 lg:px-24 flex justify-center items-start">
        <main 
          onDragEnter={handleContainerDragEnter}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={(e) => handleDropExternalFiles(e)}
          className="relative w-full max-w-4xl bg-white rounded-xl shadow-xs border border-slate-200/80 p-8 md:p-14 mb-16 h-auto self-start min-h-[90vh]"
        >
          {/* 외부 이미지 파일 드롭 안내 오버레이 */}
          {isDraggingExternalFiles && (
            <div 
              onDragOver={handleContainerDragOver}
              onDragLeave={handleContainerDragLeave}
              onDrop={(e) => handleDropExternalFiles(e)}
              className="absolute inset-0 z-50 bg-blue-500/10 backdrop-blur-2xs border-2 border-dashed border-blue-500 rounded-xl flex flex-col items-center justify-center p-8 transition-all animate-in fade-in duration-150 pointer-events-auto"
            >
              <div className="bg-white/95 rounded-2xl shadow-xl border border-blue-200 p-6 flex flex-col items-center text-center max-w-md pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-3 animate-bounce">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-1">
                  여기에 이미지를 놓으세요
                </h3>
                <p className="text-xs text-slate-500">
                  드롭한 이미지가 미디어 라이브러리에 업로드되고 기사 본문에 바로 삽입됩니다. (JPG, PNG, WebP, GIF)
                </p>
              </div>
            </div>
          )}
          
          {/* 부장 검토 모드 안내 배너 */}
          {isManagerReviewMode && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-900 text-xs">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-semibold">
                  {currentUser?.pendingApproval
                    ? '인사부 승인 대기 중: 읽기만 가능합니다. 승인되면 직접 쓰고 고칠 수 있어요.'
                    : '출고 대기 검토 모드: 본문은 고칠 수 없지만, 글을 드래그해서 피드백은 남길 수 있습니다.'}
                </span>
              </div>
              <span className="text-[11px] bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded font-bold">
                {currentUser?.pendingApproval ? '읽기 전용' : '본문 수정 불가 · 피드백 가능'}
              </span>
            </div>
          )}

          {/* 메타데이터 영역: 기사 제목 & 부제목 (보존) */}
          <div className="space-y-4 mb-6 pb-6 border-b border-slate-100">
            {/* Title Input */}
            <div>
              <input
                ref={titleInputRef}
                type="text"
                readOnly={isManagerReviewMode}
                value={article.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="기사 제목을 입력하세요..."
                className={`w-full text-2xl md:text-3xl font-extrabold text-slate-900 placeholder-slate-300 focus:outline-none transition-colors border-b border-transparent ${
                  isManagerReviewMode ? 'cursor-default' : 'focus:border-slate-300'
                }`}
              />
            </div>

            {/* Subtitle Input */}
            <div>
              <input
                type="text"
                readOnly={isManagerReviewMode}
                value={article.subtitle || ''}
                onChange={(e) => handleSubtitleChange(e.target.value)}
                placeholder="부제목(Subtitle)을 입력하세요 (선택 사항)..."
                className={`w-full text-base md:text-lg font-medium text-slate-600 placeholder-slate-300 focus:outline-none transition-colors border-b border-transparent ${
                  isManagerReviewMode ? 'cursor-default' : 'focus:border-slate-200'
                }`}
              />
            </div>

            {/* Metadata (Category & Tags 보존) */}
            <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
              {/* Category Selector */}
              <div className="flex items-center space-x-1.5 text-slate-500">
                <span className="font-semibold text-slate-700">분류:</span>
                {isManagerReviewMode ? (
                  <span className="font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                    {article.category}
                  </span>
                ) : (
                  <select
                    id="select-article-category"
                    value={article.category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="bg-slate-100 border border-slate-200 rounded px-2 py-0.5 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="정치">정치</option>
                    <option value="경제">경제</option>
                    <option value="사회">사회</option>
                    <option value="문화">문화</option>
                    <option value="IT/과학">IT/과학</option>
                    <option value="국제">국제</option>
                    <option value="스포츠">스포츠</option>
                    <option value="오피니언">오피니언</option>
                  </select>
                )}
              </div>

              {/* Tags List */}
              <div className="flex items-center flex-wrap gap-1.5 ml-auto">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                {(article.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700"
                  >
                    <span>#{tag}</span>
                    {!isManagerReviewMode && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-slate-400 hover:text-slate-700 ml-0.5 cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}

                {!isManagerReviewMode && (
                  <div className="flex items-center space-x-1">
                    <input
                      type="text"
                      id="input-new-tag"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="+ 태그 입력"
                      className="w-20 px-2 py-0.5 text-[11px] bg-slate-50 border border-slate-200 rounded focus:outline-none focus:border-blue-400 font-sans"
                    />
                    <button
                      type="button"
                      id="btn-add-tag"
                      onClick={handleAddTag}
                      className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      추가
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 기자명 및 바이라인 + 마감시간 + 배정 관리 */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 mb-6 bg-slate-50/70 rounded-lg border border-slate-200/90 text-xs text-slate-600 shadow-2xs">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="flex items-center space-x-1.5">
                <span className="font-bold text-slate-800">{article.desk}</span>
                <span className="text-slate-400">•</span>
                <span className="font-semibold text-slate-900">{article.reporter}</span>
                {article.reporterEmail && (
                  <span className="text-slate-400 text-[11px]">({article.reporterEmail})</span>
                )}
              </div>

              {/* 마감시간 표시 */}
              {deadlineFormatted && (
                <div className="flex items-center">
                  <span className="text-slate-300 mr-2">|</span>
                  {isDeadlineOverdue ? (
                    <span 
                      id="badge-editor-deadline-overdue"
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-300"
                    >
                      <Clock className="w-3 h-3 text-rose-600" />
                      <span>마감 초과 ({deadlineFormatted})</span>
                    </span>
                  ) : isDeadlineUrgent ? (
                    <span 
                      id="badge-editor-deadline-urgent"
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse"
                    >
                      <Clock className="w-3 h-3 text-amber-600" />
                      <span>마감 임박 ({deadlineFormatted})</span>
                    </span>
                  ) : (
                    <span 
                      id="badge-editor-deadline"
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200/80 text-slate-700 border border-slate-300"
                    >
                      <Calendar className="w-3 h-3 text-slate-500" />
                      <span>마감: {deadlineFormatted}</span>
                    </span>
                  )}
                </div>
              )}

              {/* 데스크 권한: 기사 배정 및 마감 변경 버튼 */}
              {isDesk && (
                <button
                  type="button"
                  id="btn-editor-assign-article"
                  onClick={() => setIsAssignModalOpen(true)}
                  className="inline-flex items-center space-x-1 px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-semibold transition-colors cursor-pointer ml-1"
                  title="기사 배정 및 마감시간 변경"
                >
                  <UserCheck className="w-3 h-3 text-blue-600" />
                  <span>배정/마감 변경</span>
                </button>
              )}

              {/* 업무 이력 확인 버튼 */}
              {onOpenAuditLogs && (
                <button
                  type="button"
                  id="btn-editor-open-audit-logs"
                  onClick={onOpenAuditLogs}
                  className="inline-flex items-center space-x-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded text-[11px] font-semibold transition-colors cursor-pointer ml-1"
                  title="기사 업무 변경 이력(Audit Log) 확인"
                >
                  <History className="w-3 h-3 text-slate-500" />
                  <span>업무 이력</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-3 text-[11px] text-slate-500">
              <span>본문 블록: <strong>{article.blocks.length}개</strong></span>
              <span>•</span>
              <span>총 글자수: <strong>{article.charCount.toLocaleString()}자</strong></span>
            </div>
          </div>

          {/* ======================================================== */}
          {/* 7. 기사 본문: 하나의 연속된 문서 편집 영역 (워드/한글형 단일 캔버스) */}
          {/* ======================================================== */}
          <BodyEditor
              key={`${article.id}:${bodyEditorEpoch ?? 0}`}
              articleId={article.id}
              blocks={article.blocks}
              readOnly={isManagerReviewMode}
              onSave={onSaveBodyDrafts}
              registerControls={handleRegisterBodyControls}
              feedbacks={feedbacks}
              highlightedFeedbackId={highlightedFeedbackId}
              aiHighlightBlockId={highlightedBlockId}
              aiHighlightText={highlightedText}
              onTextSelected={handleBodyTextSelected}
              onSelectionCollapsed={handleBodySelectionCollapsed}
            />

          {/* 8. 문서 하단 보조 툴바 (사진/영상 추가) */}
          {!isManagerReviewMode && (
            <div className="mt-12 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center space-x-2">
                <button
                  id="btn-append-image"
                  type="button"
                  onClick={() => handleOpenMediaPicker('image', article.blocks.length)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-medium">보도사진 삽입</span>
                </button>

                <button
                  id="btn-append-video"
                  type="button"
                  onClick={() => handleOpenMediaPicker('video', article.blocks.length)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                >
                  <Video className="w-3.5 h-3.5 text-purple-600" />
                  <span className="font-medium">보도영상 삽입</span>
                </button>
              </div>

              <span className="text-[11px] font-mono text-slate-400">
                워드/한글 연속 문서 편집 모드 활성화됨
              </span>
            </div>
          )}
        </main>
      </div>

      {/* 9. 텍스트 드래그 플로팅 [피드백 작성] 버튼 & 인라인 팝오버 */}
      {selectionPopover.isOpen && (
        <div
          style={{
            position: 'fixed',
            left: `${selectionPopover.coords.x}px`,
            top: `${selectionPopover.coords.y}px`,
            zIndex: 60,
          }}
          className="animate-in fade-in zoom-in-95 duration-100"
        >
          {!selectionPopover.isComposing ? (
            <button
              type="button"
              id="btn-floating-feedback"
              onClick={handleOpenComposeFeedback}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-xl text-xs font-bold transition-transform hover:scale-105 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>피드백 작성</span>
            </button>
          ) : (
            <form
              onSubmit={handleSubmitDragFeedback}
              className="w-80 bg-white border border-slate-300 rounded-xl shadow-2xl p-3 text-xs space-y-2.5 animate-in fade-in"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-900 flex items-center space-x-1">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>데스크 · 기자 피드백 작성</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectionPopover(prev => ({ ...prev, isOpen: false, isComposing: false }))}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 선택한 원문 인용 미리보기 */}
              <div className="p-2 bg-emerald-50 border-l-2 border-emerald-500 rounded text-[11px] text-emerald-950 font-serif italic line-clamp-2">
                "{selectionPopover.selectedText}"
              </div>

              {/* 피드백 메모 입력란 */}
              <textarea
                id="textarea-drag-feedback"
                rows={3}
                value={feedbackMemoInput}
                onChange={(e) => setFeedbackMemoInput(e.target.value)}
                placeholder="선택한 문장에 대한 데스크 지시나 보완 의견을 입력하세요..."
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white resize-none font-sans"
                autoFocus
              />

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] text-slate-400 font-medium">색상:</span>
                  {(['emerald', 'amber', 'blue', 'rose', 'purple'] as HighlighterColor[]).map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setFeedbackMemoColor(col)}
                      className={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                        HIGHLIGHTER_STYLES[col].dot
                      } ${
                        feedbackMemoColor === col
                          ? 'ring-2 ring-offset-1 ring-slate-800 scale-125'
                          : 'opacity-50 hover:opacity-100 hover:scale-110'
                      }`}
                      title={`${HIGHLIGHTER_STYLES[col].label} 색상`}
                    />
                  ))}
                </div>

                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectionPopover(prev => ({ ...prev, isOpen: false, isComposing: false }))}
                    className="px-2.5 py-1 text-slate-600 hover:text-slate-800 rounded text-[11px]"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={!feedbackMemoInput.trim()}
                    className="px-3 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-[11px] font-bold flex items-center space-x-1 cursor-pointer"
                  >
                    <Send className="w-3 h-3 text-emerald-400" />
                    <span>메모 등록</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* 10. MEDIA PICKER MODAL */}
      <MediaPickerModal
        isOpen={mediaPickerConfig.isOpen}
        type={mediaPickerConfig.type}
        targetIndex={mediaPickerConfig.targetIndex}
        mediaItems={mediaLibrary}
        onClose={() => setMediaPickerConfig(prev => ({ ...prev, isOpen: false }))}
        onSelectMedia={(item, targetIndex) => {
          onInsertMediaAt(item, targetIndex);
        }}
        onOpenFullLibrary={onOpenMediaDrawer}
      />

      {/* 12. TXT IMPORT MODAL */}
      {onImportTxtBlocks && !isManagerReviewMode && (
        <TxtImportModal
          isOpen={isTxtModalOpen}
          onClose={() => setIsTxtModalOpen(false)}
          onConfirmImport={async (paragraphs: string[], mode: 'append' | 'replace') => {
            await onImportTxtBlocks(paragraphs, mode);
          }}
          currentBlockCount={article.blocks.length}
        />
      )}

      {/* 13. 기사 배정 및 마감시간 변경 모달 (데스크 권한 전용) */}
      {isDesk && isAssignModalOpen && (
        <AssignArticleModal
          isOpen={isAssignModalOpen}
          onClose={() => setIsAssignModalOpen(false)}
          articleId={article.id}
          articleTitle={article.title}
          currentAuthorId={article.authorId || ''}
          currentDeadlineAt={article.deadlineAt}
          onSuccess={(newAuthorId?: string, newDeadline?: string | null, newAuthorName?: string) => {
            onUpdateArticle({
              ...article,
              authorId: newAuthorId || article.authorId,
              reporter: newAuthorName || article.reporter,
              deadlineAt: newDeadline,
            });
          }}
        />
      )}
    </div>
  );
};
