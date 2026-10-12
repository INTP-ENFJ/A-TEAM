import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Sparkles, Loader2, Newspaper, AlertTriangle, WifiOff, FileText, BarChart3, Clock } from 'lucide-react';
import { TopHeader } from './components/TopHeader';
import { LeftSidebar } from './components/LeftSidebar';
import { ArticleEditor } from './components/editor/ArticleEditor';
import { AiReviewPanel } from './components/editor/AiReviewPanel';
import { InfographicPanel } from './components/editor/InfographicPanel';
import { AiInterviewDraftPanel } from './components/editor/AiInterviewDraftPanel';
import { FeedbackPanel } from './components/editor/FeedbackPanel';
import { AuditLogPanel } from './components/audit/AuditLogPanel';
import { MediaLibraryView } from './components/media/MediaLibraryView';
import { ProjectDashboard } from './components/dashboard/ProjectDashboard';
import { ArticlePreview } from './components/preview/ArticlePreviewModal';
import { SettingsView } from './components/settings/SettingsView';
import { VersionHistoryModal } from './components/history/VersionHistoryModal';
import { PublishModal } from './components/publish/PublishModal';
import { LoginView } from './components/auth/LoginView';
import { supabase } from './lib/supabase';
import { projectService } from './services/projectService';
import { articleService, ArticleConflictError } from './services/articleService';
import { articleBlockService } from './services/articleBlockService';
import { createBodySyncState, syncBodyDrafts, calcBodyCharCount, BodySyncState } from './services/bodySyncService';
import type { BodyBlockDraft } from './components/editor/bodyEditorModel';
import { mediaItemToBodyAttrs } from './components/editor/bodyEditorModel';
import type { BodyEditorControls } from './components/editor/BodyEditor';
import { mediaService } from './services/mediaService';
import { aiReviewService } from './services/aiReviewService';
import { feedbackService } from './services/feedbackService';
import { articleVersionService } from './services/articleVersionService';
import { articleWorkflowService } from './services/articleWorkflowService';
import { 
  Article, 
  ArticleBlock, 
  ArticleFeedback,
  FeedbackReply,
  MediaItem, 
  Project, 
  User, 
  VersionSnapshot,
  ProjectVisibility,
  ReactionType,
  isHrAdmin,
  isDeskUser,
  SaveStatus,
  ConflictInfo,
  ArticleStatus
} from './types';
import { HrDashboard } from './components/hr/HrDashboard';
import { RequestChangesModal } from './components/workflow/RequestChangesModal';
import { ApproveConfirmModal } from './components/workflow/ApproveConfirmModal';
import { UserGuideView } from './components/guide/UserGuideView';
import { setBlurUploadConfig } from './components/editor/blurConfig';

// AI 초안 반영 이력을 구분하는 표시 (버전 요약 앞부분)
const AI_DRAFT_VERSION_PREFIX = 'AI 초안 반영';

export default function App() {
  // Supabase Auth 세션 기반 사용자 상태 (유일한 source of truth)
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // 세션 확인 전 LoginView 깜빡임 방지용 로딩 상태
  const [authLoading, setAuthLoading] = useState(true);

  // 현재 로그인된 사용자 UUID 추적 (토큰 갱신과 실제 사용자 변경을 구분)
  const currentUserIdRef = useRef<string | null>(null);

  // Screen state (인사부 관리자는 'hr' 화면 전용, guide는 사용법 안내)
  const [activeScreen, setActiveScreen] = useState<'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media'>('dashboard');

  // 사용자가 대시보드에서 명시적으로 기사/프로젝트를 선택했는지 여부
  const [hasSelectedArticle, setHasSelectedArticle] = useState(false);

  // Core Supabase DB State
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [article, setArticle] = useState<Article | null>(null);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);

  // 활성 기사 ID 추적 (Autosave Race Condition 방지 핵심 가드)
  const activeArticleIdRef = useRef<string | null>(null);

  // 5단계: 실제 Supabase Storage + media 테이블 연동 State
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);

  // 기사 Version History State (Supabase article_versions 영속 연동)
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);

  // Mock 기능 유지용 State (AI Review, Feedback)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [highlightedFeedbackId, setHighlightedFeedbackId] = useState<string | null>(null);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [scanCooldownSeconds, setScanCooldownSeconds] = useState(0);

  // AI 검수 쿨다운 카운트다운 타이머
  useEffect(() => {
    if (scanCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setScanCooldownSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [scanCooldownSeconds]);

  // Right Panel Mode: 'feedback' | 'ai' | 'audit' | 'aidraft'
  const [rightPanelTab, setRightPanelTab] = useState<'feedback' | 'ai' | 'audit' | 'aidraft' | 'infographic' | 'media'>('feedback');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Media Library Drawer state
  const [isMediaDrawerOpen, setIsMediaDrawerOpen] = useState(false);
  // 미디어 라이브러리 카드 드래그 중 상태 (ArticleEditor 드롭존 노출용)
  const [, setIsDraggingLibraryMedia] = useState(false);

  // 전역 드래그 종료 감지 (드롭 완료 또는 취소 시 안전하게 false 복구)
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setIsDraggingLibraryMedia(false);
    };
    window.addEventListener('dragend', handleGlobalDragEnd);
    return () => window.removeEventListener('dragend', handleGlobalDragEnd);
  }, []);

  // Modals state
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isRequestChangesModalOpen, setIsRequestChangesModalOpen] = useState(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false);

  // Auto-save & Reliability state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string>('방금 전');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  
  // Metadata Autosave Refs & Sequence
  const metadataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetadataRef = useRef<Partial<Article> | null>(null);
  const metadataSaveSeqRef = useRef<number>(0);
  const isMetadataSavingRef = useRef<boolean>(false);

  // Block Text Autosave Refs & Sequence
  const blockTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingBlockTextsRef = useRef<Map<string, string>>(new Map());
  const articleRef = useRef<Article | null>(null);

  // Generation Token & Optimistic Concurrency Ref
  const articleGenerationRef = useRef<number>(0);
  const lastKnownUpdatedAtRef = useRef<string | null>(null);

  // article 상태 변경 시 articleRef 항상 동기화
  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  /**
   * 임시 블록 ID(blk_p_...) 판별 헬퍼
   * - PostgreSQL UUID가 아닌 프론트엔드 임시 ID인 경우 true 반환
   */
  const isTemporaryBlockId = (id: string): boolean => {
    return typeof id === 'string' && (id.startsWith('blk_') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  };

  // 대량 Paste 등 다수 임시 블록 일괄 저장용 Batch Ref
  const tempBlocksBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingTempBatchRef = useRef<boolean>(false);
  const needsReorderRef = useRef<boolean>(false);

  /**
   * 대기 중인 모든 임시 ID 블록(blk_p_...)을 1회의 원자적 Batch INSERT로 일괄 생성하고 실제 UUID로 치환
   */
  const savePendingTempBlocksBatch = useCallback(async (): Promise<void> => {
    if (isSavingTempBatchRef.current) return;
    const targetArtId = activeArticleIdRef.current || articleRef.current?.id;
    if (!targetArtId || !navigator.onLine) return;

    // 이전에 순서 정리(재정렬)가 실패했다면 먼저 다시 시도한다.
    const retryReorderOnly = async () => {
      if (!needsReorderRef.current) return;
      const ids = (articleRef.current?.blocks || []).map(b => b.id);
      if (ids.some(isTemporaryBlockId)) return;
      await articleBlockService.reorderBlocks(targetArtId, ids);
      needsReorderRef.current = false;
    };

    const entries = Array.from(pendingBlockTextsRef.current.entries());
    const tempEntries = entries.filter(([blkId]) => isTemporaryBlockId(blkId));
    if (tempEntries.length === 0) {
      isSavingTempBatchRef.current = true;
      try {
        await retryReorderOnly();
      } finally {
        isSavingTempBatchRef.current = false;
      }
      return;
    }

    isSavingTempBatchRef.current = true;
    try {
      const currentBlocks = articleRef.current?.blocks || [];
      // 저장 대기 중인 글 + 화면에는 있지만 아직 DB에 없는 빈 문단도 함께 저장한다.
      // (순서 정리 때 "화면 블록 수 = DB 블록 수"가 맞아야 하기 때문)
      const pendingMap = new Map(tempEntries);
      const tempTargets: Array<{ tempId: string; text: string }> = [];
      currentBlocks.forEach(b => {
        if (isTemporaryBlockId(b.id) && (b.type === 'paragraph' || pendingMap.has(b.id))) {
          tempTargets.push({ tempId: b.id, text: pendingMap.get(b.id) ?? b.text ?? '' });
        }
      });
      tempEntries.forEach(([blkId, text]) => {
        if (!tempTargets.some(t => t.tempId === blkId)) tempTargets.push({ tempId: blkId, text });
      });

      // 기존 저장 블록과 번호가 겹치지 않도록 충분히 큰 임시 번호로 저장하고, 저장 뒤에 0,1,2… 로 정리한다.
      const tempBase = 1000000 + (Date.now() % 1000000) * 100;
      const batchItems = tempTargets.map((t, i) => ({
        tempId: t.tempId,
        text: t.text,
        positionIndex: tempBase + i,
      }));

      const createdList = await articleBlockService.createBlocksBatch(
        targetArtId,
        batchItems.map(b => ({
          type: 'paragraph',
          text: b.text,
          positionIndex: b.positionIndex,
        }))
      );

      const idMap = new Map<string, string>();
      batchItems.forEach((item, idx) => {
        if (createdList[idx]) {
          idMap.set(item.tempId, createdList[idx].id);
        }
      });

      // 1. articleRef.current의 blocks 즉시 실제 UUID로 갱신 (지연 방지)
      if (articleRef.current) {
        articleRef.current = {
          ...articleRef.current,
          blocks: articleRef.current.blocks.map(b => {
            const realId = idMap.get(b.id);
            return realId ? { ...b, id: realId } : b;
          }),
        };
      }

      // 2. React state 내 임시 ID를 실제 발급된 UUID로 일괄 교체
      setArticle(prev => {
        if (!prev) return null;
        const updatedBlocks = prev.blocks.map(b => {
          const realId = idMap.get(b.id);
          return realId ? { ...b, id: realId } : b;
        });
        return { ...prev, blocks: updatedBlocks };
      });

      // 3. pending 키 일괄 치환 및 정리
      for (const [tempId, realId] of idMap.entries()) {
        const textAtSave = batchItems.find(b => b.tempId === tempId)?.text;
        const latestText = pendingBlockTextsRef.current.get(tempId);
        pendingBlockTextsRef.current.delete(tempId);
        if (latestText !== undefined && latestText !== textAtSave) {
          pendingBlockTextsRef.current.set(realId, latestText);
        }
      }

      // 4. 화면 순서 그대로 번호를 0,1,2… 로 정리 (실패해도 글은 이미 저장됨 → 다음 저장 때 재시도)
      needsReorderRef.current = true;
      try {
        await retryReorderOnly();
      } catch (reorderErr) {
        console.error('[savePendingTempBlocksBatch] reorder failed (will retry):', reorderErr);
      }
    } catch (err: any) {
      console.error('[savePendingTempBlocksBatch] Error:', err);
      throw err;
    } finally {
      isSavingTempBatchRef.current = false;
    }
  }, []);

  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // In-app Notification trigger state
  const [notificationTrigger, setNotificationTrigger] = useState<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // 기사 작성자 여부 판별
  const isAuthor = Boolean(
    currentUser &&
    article &&
    article.authorId &&
    currentUser.id &&
    article.authorId === currentUser.id
  );

  // 데스크(부장/차장/데스크에디터/편집국장) 권한 여부 판별 (타인 기사 검토자)
  const isDesk = Boolean(
    isDeskUser(currentUser) &&
    article &&
    currentUser?.id &&
    article.authorId !== currentUser.id
  );

  // 데스크 검토/읽기 전용 모드 판별
  // - 데스크가 다른 기자의 review, ready, published 기사를 조회할 때 편집 제한 (isDesk에 타인 기사 조건 포함됨)
  // 인사부 승인 전 계정은 모든 기사를 읽기만 할 수 있다 (같은 읽기 전용 화면을 사용)
  const isPendingApproval = Boolean(currentUser?.pendingApproval);
  const isManagerReviewMode = Boolean(
    (isPendingApproval && article) ||
    (isDesk &&
      article &&
      (article.status === 'review' || article.status === 'ready' || article.status === 'published'))
  );

  // 승인 전 계정이 수정 기능을 누르면 막고 안내한다 (true면 막힘)
  const blockIfPending = (): boolean => {
    if (!currentUser?.pendingApproval) return false;
    showToast('인사부 승인 전에는 읽기만 할 수 있습니다. 승인이 끝나면 사용할 수 있어요.');
    return true;
  };

  // ==========================================
  // 새 본문 편집기(워드/한글형, 시험 중) 저장 연결
  // ==========================================
  const bodySyncStatesRef = useRef<Map<string, BodySyncState>>(new Map());
  const bodyEditorActiveRef = useRef<boolean>(false);
  const bodyControlsRef = useRef<BodyEditorControls | null>(null);
  // 최신 기사 다시 불러오기 때 새 편집기를 새로 시작하기 위한 번호
  const [bodyEditorEpoch, setBodyEditorEpoch] = useState<number>(0);

  // 미디어 탭에서 [기사에 넣기]를 눌렀을 때, 편집기가 열린 뒤에 넣을 사진 목록
  const pendingInsertRef = useRef<MediaItem[] | null>(null);
  // 편집기 본문에 끌어다 놓은 사진: 곧장 올리지 않고 [미디어] 탭 올리기 창에서 제목·캡션을 적게 함
  const [externalUploadFiles, setExternalUploadFiles] = useState<File[]>([]);
  const clearExternalUploadFiles = useCallback(() => setExternalUploadFiles([]), []);

  const handleRegisterBodyControls = useCallback((controls: BodyEditorControls | null) => {
    bodyControlsRef.current = controls;
    if (controls && pendingInsertRef.current) {
      const items = pendingInsertRef.current;
      pendingInsertRef.current = null;
      window.setTimeout(() => {
        const ok = controls.insertMedia(items.map(mediaItemToBodyAttrs), 'end');
        showToast(ok ? `${items.length}개 미디어를 기사 맨 아래에 넣었습니다. (자동 저장됩니다)` : '미디어를 넣지 못했습니다.');
      }, 600);
    }
  }, [showToast]);

  const handleBodyEditorActiveChange = useCallback((active: boolean) => {
    // 새 편집기를 켤 때마다 DB 기준 상태를 새로 만든다 (기존 편집기에서 바뀐 블록과 어긋나 중복 저장되는 것을 방지)
    if (active && !bodyEditorActiveRef.current) bodySyncStatesRef.current.clear();
    bodyEditorActiveRef.current = active;
  }, []);

  /** 새 편집기를 쓰는 동안에는 기존 방식의 블록 조작(사진 삽입·TXT 가져오기 등)을 막는다 */
  const isBlockedByNewBodyEditor = useCallback((): boolean => {
    if (!bodyEditorActiveRef.current) return false;
    showToast('본문 편집기를 준비하는 중입니다. 잠시 후 다시 시도해 주세요.');
    return true;
  }, [showToast]);

  /** 새 편집기 내용을 DB(article_blocks)와 맞춘다. 초안과 같은 순서의 실제 블록 ID 목록을 돌려준다. */
  const saveBodyDrafts = useCallback(async (drafts: BodyBlockDraft[], articleId: string): Promise<string[]> => {
    if (isManagerReviewMode) throw new Error('검수 모드에서는 저장할 수 없습니다.');
    if (!navigator.onLine) {
      setSaveStatus('offline');
      throw new Error('오프라인 상태입니다.');
    }

    let state = bodySyncStatesRef.current.get(articleId);
    if (!state) {
      const current = articleRef.current;
      if (!current || current.id !== articleId) throw new Error('저장할 기사를 찾을 수 없습니다.');
      state = createBodySyncState(articleId, current.blocks);
      bodySyncStatesRef.current.set(articleId, state);
    }

    setSaveStatus('saving');
    try {
      const { ids, blocks } = await syncBodyDrafts(state, drafts);
      setArticle(prev => {
        if (!prev || prev.id !== articleId) return prev;
        const prevById = new Map(prev.blocks.map(b => [b.id, b]));
        const merged = blocks.map(b => ({ ...(prevById.get(b.id) || {}), ...b }));
        return { ...prev, blocks: merged, charCount: calcBodyCharCount(merged, prev.title, prev.subtitle) };
      });
      if (!pendingMetadataRef.current && pendingBlockTextsRef.current.size === 0) {
        setSaveStatus('saved');
      }
      const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      setLastSavedTime(nowStr);
      return ids;
    } catch (err: any) {
      console.error('[App.saveBodyDrafts] Error:', err);
      // 다른 사람이 동시에 블록을 추가/삭제한 경우: 계속 재시도하지 않고 충돌 안내를 띄운다
      if (String(err?.message || '').includes('일치하지 않습니다')) {
        bodySyncStatesRef.current.delete(articleId);
        setConflictInfo({ detected: true });
        setSaveStatus('error');
        showToast('다른 사람이 같은 기사를 먼저 수정했습니다. 상단 안내에서 최신 기사를 불러와 주세요.');
        const conflictErr: any = new Error('동시 수정 충돌');
        conflictErr.noRetry = true;
        throw conflictErr;
      }
      setSaveStatus(navigator.onLine ? 'error' : 'offline');
      showToast(`본문 저장 실패 (자동으로 다시 시도합니다): ${err.message || '네트워크를 확인해주세요.'}`);
      throw err;
    }
  }, [isManagerReviewMode, showToast]);

  // 계정 변경 또는 로그아웃 시 UI 화면 및 기사 선택 상태 초기화
  const resetSessionUI = useCallback(() => {
    setActiveScreen('dashboard');
    setHasSelectedArticle(false);
    setSelectedReviewId(null);
    setIsMediaDrawerOpen(false);
    setIsHistoryModalOpen(false);
    setIsPublishModalOpen(false);
    setIsRequestChangesModalOpen(false);
    setIsApproveModalOpen(false);
    setArticle(null);
    setSnapshots([]);
    setMediaLibrary([]);
    activeArticleIdRef.current = null;
    if (metadataTimerRef.current) {
      clearTimeout(metadataTimerRef.current);
      metadataTimerRef.current = null;
    }
    blockTimersRef.current.forEach(timer => clearTimeout(timer));
    blockTimersRef.current.clear();
    pendingMetadataRef.current = null;
    pendingBlockTextsRef.current.clear();
  }, []);

  // 1. Supabase 프로젝트 목록 로드
  const projectsJsonRef = useRef<string>('');
  // silent=true 이면 로딩 표시 없이 조용히 갱신하고, 내용이 달라졌을 때만 화면을 바꾼다 (자동 새로고침용)
  const loadProjects = useCallback(async (silent: boolean = false) => {
    try {
      if (!silent) setIsLoadingProjects(true);
      const data = await projectService.getProjects();
      const json = JSON.stringify(data);
      if (!silent || json !== projectsJsonRef.current) {
        projectsJsonRef.current = json;
        setProjects(data);
      }
    } catch (err: any) {
      console.error('[App.loadProjects] Error:', err);
      if (!silent) showToast(err.message || '프로젝트 목록을 불러오지 못했습니다.');
    } finally {
      if (!silent) setIsLoadingProjects(false);
    }
  }, [showToast]);

  // 1-1. 특정 프로젝트의 미디어 라이브러리 로드 (Signed URL 동적 발급)
  const loadProjectMedia = useCallback(async (projectId: string) => {
    try {
      setIsLoadingMedia(true);
      const items = await mediaService.getProjectMedia(projectId);
      setMediaLibrary(items);
    } catch (err: any) {
      console.error(`[App.loadProjectMedia] Error loading media for project ${projectId}:`, err);
      // 에러 시 토스트는 필요에 따라 제한
    } finally {
      setIsLoadingMedia(false);
    }
  }, []);

  // 1-2. 기사 Version History 목록 DB 로드
  const loadArticleVersions = useCallback(async (articleId: string) => {
    try {
      setIsLoadingVersions(true);
      const versions = await articleVersionService.getVersions(articleId);
      setSnapshots(versions);
    } catch (err: any) {
      console.error(`[App.loadArticleVersions] Error loading versions for article ${articleId}:`, err);
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  // 2. 특정 프로젝트의 대표 기사 DB 로드
  const loadArticleForProject = useCallback(async (projectId: string) => {
    try {
      setIsLoadingArticle(true);
      // 이전 기사의 pending autosave 플러시 완료 후 새 기사 로드 (데이터 유실 및 race condition 방어)
      await flushPendingSaves();

      const art = await articleService.getArticleByProjectId(projectId);
      try {
        const dbFeedbacks = await feedbackService.getFeedbacksByArticleId(art.id);
        if (dbFeedbacks && dbFeedbacks.length > 0) {
          art.feedbacks = dbFeedbacks;
        }
      } catch (fbErr) {
        console.warn('[App.loadArticleForProject] Feedback fetch failed:', fbErr);
      }
      setArticle(art);
      activeArticleIdRef.current = art.id;
      lastKnownUpdatedAtRef.current = art.updatedAt || null;
      setConflictInfo(null);
      articleGenerationRef.current++;
      setLastSavedTime(art.lastSaved || '방금 전');
      setSaveStatus('saved');
      setHasSelectedArticle(true);
      setActiveScreen('editor');

      // 프로젝트 미디어 로드 (Signed URL 발급 포함)
      loadProjectMedia(projectId);

      // 기사 Version History 로드
      loadArticleVersions(art.id);
    } catch (err: any) {
      console.error(`[App.loadArticleForProject] Error loading for project ${projectId}:`, err);
      showToast(err.message || '기사 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoadingArticle(false);
    }
  }, [showToast, loadProjectMedia, loadArticleVersions]);

  // Drawer 열릴 때 프로젝트 미디어 최신화 (Signed URL 만료 대비 및 실시간 동기화)
  useEffect(() => {
    if (isMediaDrawerOpen && article?.projectId) {
      loadProjectMedia(article.projectId);
    }
  }, [isMediaDrawerOpen, article?.projectId, loadProjectMedia]);

  // Version History Modal 열릴 때 최신 버전 목록 재조회
  useEffect(() => {
    if (isHistoryModalOpen && article?.id) {
      loadArticleVersions(article.id);
    }
  }, [isHistoryModalOpen, article?.id, loadArticleVersions]);

  // Supabase Auth 세션 복원 및 프로필 조회 Effect
  useEffect(() => {
    let isMounted = true;

    const fetchUserProfile = async (userId: string, email?: string) => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('id, name, role, rank, role_title, department, department_id, position_title_id, can_manage_signups, avatar_url, recovery_email')
          .eq('id', userId)
          .single();

        if (error || !profile) {
          console.error('Session profile fetch error:', error);
          if (isMounted) setCurrentUser(null);
          return;
        }

        // 승인 대기 여부는 서버가 정한 표식(app_metadata)으로 판단한다 (본인이 바꿀 수 없음)
        let pendingApproval = false;
        try {
          const { data: authData } = await supabase.auth.getUser();
          pendingApproval = (authData?.user?.app_metadata as Record<string, unknown> | undefined)?.approval === 'pending';
        } catch {
          pendingApproval = false;
        }

        const mappedUser: User = {
          id: profile.id,
          name: profile.name,
          role: profile.role,
          rank: profile.rank,
          roleTitle: profile.role_title || '',
          department: profile.department || '',
          departmentId: profile.department_id || undefined,
          positionTitleId: profile.position_title_id || undefined,
          canManageSignups: Boolean(profile.can_manage_signups),
          email: email || '',
          avatar: profile.avatar_url || '',
          recoveryEmail: profile.recovery_email || '',
          pendingApproval,
        };

        if (isMounted) {
          const isSameUser = currentUserIdRef.current === mappedUser.id;
          if (!isSameUser) {
            currentUserIdRef.current = mappedUser.id;
            resetSessionUI();
            setActiveScreen(isHrAdmin(mappedUser) ? 'hr' : 'dashboard');
          }
          // 같은 사용자의 정보가 그대로면 화면을 다시 그리지 않는다 (다른 창에 다녀왔을 때 깜빡임 방지)
          setCurrentUser(prev => (prev && JSON.stringify(prev) === JSON.stringify(mappedUser) ? prev : mappedUser));
          // 뉴스룸 사용자인 경우 프로젝트 목록 로드 (이미 같은 사용자로 로그인되어 있으면 다시 불러오지 않음)
          if (!isHrAdmin(mappedUser) && !isSameUser) {
            loadProjects();
          }
        }
      } catch (err) {
        console.error('Failed to restore user session:', err);
        if (isMounted) {
          if (currentUserIdRef.current !== null) {
            currentUserIdRef.current = null;
            resetSessionUI();
          }
          setCurrentUser(null);
        }
      }
    }

    // 1. 초기 세션 조회
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchUserProfile(session.user.id, session.user.email).finally(() => {
          if (isMounted) setAuthLoading(false);
        });
      } else {
        if (isMounted) {
          if (currentUserIdRef.current !== null) {
            currentUserIdRef.current = null;
            resetSessionUI();
          }
          setCurrentUser(null);
          setAuthLoading(false);
        }
      }
    });

    // 2. Auth 상태 변경 리스너 등록
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        if (isMounted) {
          if (currentUserIdRef.current !== null) {
            currentUserIdRef.current = null;
            resetSessionUI();
          }
          setCurrentUser(null);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        // 다른 창에 다녀오면 같은 로그인 알림이 다시 오는데, 이미 이 사용자로 열려 있으면 무시한다
        if (currentUserIdRef.current === session.user.id) return;
        fetchUserProfile(session.user.id, session.user.email);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadProjects, resetSessionUI]);

  // 승인 대기 중인 계정: 인사부가 승인하면 새로고침 없이도 곧 모든 기능이 열리도록 주기적으로 확인한다
  useEffect(() => {
    if (!currentUser?.pendingApproval) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await supabase.auth.getUser();
        const mark = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.approval;
        if (data?.user && mark !== 'pending') {
          window.location.reload();
        }
      } catch {
        // 일시적인 연결 문제는 다음 확인 때 다시 시도
      }
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [currentUser?.pendingApproval]);

  // 다른 사람이 기사 상태를 바꿨을 때 새로고침 없이 반영: 대시보드를 보고 있는 동안 30초마다, 그리고 이 창으로 돌아왔을 때 조용히 다시 불러온다
  useEffect(() => {
    if (!currentUser || isHrAdmin(currentUser) || activeScreen !== 'dashboard') return;
    const refresh = () => {
      if (document.visibilityState === 'visible') loadProjects(true);
    };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [currentUser?.id, activeScreen, loadProjects]);

  // ==========================================
  // Autosave & Concurrency & Network Protection (안정성 강화)
  // ==========================================

  /**
   * 전환/종료/워크플로우 전 대기 중인 모든 autosave(메타데이터 및 블록 본문)를 즉시 플러시(저장)
   * - 실패 시 pending 데이터를 유실하지 않고 보존하며 에러를 throw하여 후속 작업 중단
   */
  const flushPendingSaves = useCallback(async () => {
    // 1. 모든 debounce 타이머 즉시 취소
    if (metadataTimerRef.current) {
      clearTimeout(metadataTimerRef.current);
      metadataTimerRef.current = null;
    }
    blockTimersRef.current.forEach(timer => clearTimeout(timer));
    blockTimersRef.current.clear();

    const currentGen = articleGenerationRef.current;
    const targetArtId = activeArticleIdRef.current;
    const promises: Promise<any>[] = [];

    // 2. Flush Metadata (콘텐츠 전용 업데이트 및 동시성 검증)
    if (targetArtId && pendingMetadataRef.current) {
      const toSave = { ...pendingMetadataRef.current };
      promises.push((async () => {
        try {
          const updated = await articleService.updateArticle(
            targetArtId, 
            toSave, 
            { 
              expectedUpdatedAt: lastKnownUpdatedAtRef.current || undefined,
              contentOnly: true 
            }
          );
          // 성공 시에만 저장 완료된 키들을 pending에서 제거
          if (pendingMetadataRef.current) {
            for (const key of Object.keys(toSave) as (keyof Article)[]) {
              if (pendingMetadataRef.current[key] === toSave[key]) {
                delete pendingMetadataRef.current[key];
              }
            }
            if (Object.keys(pendingMetadataRef.current).length === 0) {
              pendingMetadataRef.current = null;
            }
          }
          if (updated.updatedAt) {
            lastKnownUpdatedAtRef.current = updated.updatedAt;
          }
        } catch (err: any) {
          if (err instanceof ArticleConflictError) {
            setConflictInfo({
              detected: true,
              serverUpdatedAt: err.serverUpdatedAt,
              serverTitle: err.serverTitle,
            });
          }
          throw err;
        }
      })());
    }

    // 3. Flush Block Texts (각 블록별 본문 저장)
    if (pendingBlockTextsRef.current.size > 0) {
      const entries = Array.from(pendingBlockTextsRef.current.entries());

      // 3-1. 임시 ID 블록(blk_p_...)을 원자적 Batch INSERT로 일괄 생성하여 실제 UUID로 변환
      if (tempBlocksBatchTimerRef.current) {
        clearTimeout(tempBlocksBatchTimerRef.current);
        tempBlocksBatchTimerRef.current = null;
      }
      const tempEntries = entries.filter(([blkId]) => isTemporaryBlockId(blkId));
      if (tempEntries.length > 0) {
        await savePendingTempBlocksBatch();
      }

      // 3-2. 이미 DB에 존재하는 실제 UUID 블록들에 대해 updateBlock 병렬 플러시 실행
      const remainingEntries = Array.from(pendingBlockTextsRef.current.entries()).filter(([blkId]) => !isTemporaryBlockId(blkId));
      for (const [blkId, text] of remainingEntries) {
        promises.push((async () => {
          await articleBlockService.updateBlock(blkId, { text });
          // 성공 시 텍스트가 그 사이 변경되지 않았다면 pending에서 제거
          if (pendingBlockTextsRef.current.get(blkId) === text) {
            pendingBlockTextsRef.current.delete(blkId);
          }
        })());
      }
    }

    // 4. 새 본문 편집기(시험 중)에 저장 안 된 변경이 있으면 함께 저장
    if (bodyControlsRef.current) {
      promises.push(bodyControlsRef.current.flush());
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
        if (currentGen === articleGenerationRef.current) {
          setSaveStatus('saved');
          const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          setLastSavedTime(nowStr);
        }
      } catch (err: any) {
        setSaveStatus(navigator.onLine ? 'error' : 'offline');
        console.error('[flushPendingSaves] Failed:', err);
        throw err; // 오류를 절대 삼키지 않고 전파하여 상위 흐름(Review/Publish/Move) 중단
      }
    }
  }, []);

  // 컴포넌트 언마운트 시 autosave 타이머 정리
  useEffect(() => {
    return () => {
      if (metadataTimerRef.current) {
        clearTimeout(metadataTimerRef.current);
      }
      if (tempBlocksBatchTimerRef.current) {
        clearTimeout(tempBlocksBatchTimerRef.current);
      }
      blockTimersRef.current.forEach(timer => clearTimeout(timer));
      blockTimersRef.current.clear();
    };
  }, []);

  // 네트워크 Online / Offline 감지 및 안전 복구
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('네트워크 연결이 복구되었습니다.');
      // 대기 중인 미저장 변경사항이 있다면 안전하게 자동 저장 재시도
      if (pendingMetadataRef.current || pendingBlockTextsRef.current.size > 0) {
        flushPendingSaves().catch(err => {
          console.warn('[Network Reconnect] Auto-flush retry failed:', err);
        });
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSaveStatus('offline');
      showToast('네트워크 연결이 끊겼습니다. 작성 중인 내용은 브라우저에 안전하게 유지됩니다.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushPendingSaves, showToast]);

  // beforeunload: 미저장 변경사항이나 저장 실패 시 브라우저 기본 이탈 경고
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUnsaved = Boolean(
        pendingMetadataRef.current ||
        pendingBlockTextsRef.current.size > 0 ||
        metadataTimerRef.current ||
        blockTimersRef.current.size > 0 ||
        saveStatus === 'error' ||
        saveStatus === 'offline'
      );

      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveStatus]);

  /**
   * 800ms Debounced Article Metadata Autosave (직렬화 큐 및 최신 내용 보호)
   */
  const scheduleMetadataAutosave = useCallback((targetArticle: Article, updates: Partial<Article>) => {
    if (isManagerReviewMode) return;

    const targetArticleId = targetArticle.id;
    setSaveStatus(navigator.onLine ? 'saving' : 'offline');

    pendingMetadataRef.current = {
      ...(pendingMetadataRef.current || {}),
      ...updates,
    };

    if (metadataTimerRef.current) {
      clearTimeout(metadataTimerRef.current);
    }

    metadataTimerRef.current = setTimeout(async () => {
      metadataTimerRef.current = null;
      const currentGen = articleGenerationRef.current;

      if (activeArticleIdRef.current !== targetArticleId) {
        console.warn(`[Metadata Autosave] Target article ${targetArticleId} is no longer active. Aborting.`);
        return;
      }

      if (currentUser && targetArticle.authorId && targetArticle.authorId !== currentUser.id) {
        setSaveStatus('saved');
        return;
      }

      if (isMetadataSavingRef.current) return;
      isMetadataSavingRef.current = true;

      while (pendingMetadataRef.current && activeArticleIdRef.current === targetArticleId && currentGen === articleGenerationRef.current) {
        if (!navigator.onLine) {
          setSaveStatus('offline');
          break;
        }

        const toSave = { ...pendingMetadataRef.current };
        const thisSeq = ++metadataSaveSeqRef.current;
        setSaveStatus('saving');

        try {
          const updated = await articleService.updateArticle(
            targetArticleId, 
            toSave, 
            { 
              expectedUpdatedAt: lastKnownUpdatedAtRef.current || undefined,
              contentOnly: true 
            }
          );

          // 성공 시 해당 키들만 pending에서 안전하게 제거
          if (pendingMetadataRef.current) {
            for (const key of Object.keys(toSave) as (keyof Article)[]) {
              if (pendingMetadataRef.current[key] === toSave[key]) {
                delete pendingMetadataRef.current[key];
              }
            }
            if (Object.keys(pendingMetadataRef.current).length === 0) {
              pendingMetadataRef.current = null;
            }
          }

          if (updated.updatedAt) {
            lastKnownUpdatedAtRef.current = updated.updatedAt;
          }

          // 최신 요청 seq일 때만 UI 완료 반영 (순서 역전 방지)
          if (metadataSaveSeqRef.current === thisSeq && activeArticleIdRef.current === targetArticleId && currentGen === articleGenerationRef.current) {
            const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            setLastSavedTime(nowStr);
            if (!pendingMetadataRef.current && pendingBlockTextsRef.current.size === 0) {
              setSaveStatus('saved');
            }
          }
        } catch (err: any) {
          if (err instanceof ArticleConflictError) {
            setConflictInfo({
              detected: true,
              serverUpdatedAt: err.serverUpdatedAt,
              serverTitle: err.serverTitle,
            });
            setSaveStatus('error');
            showToast('다른 사용자의 수정이 감지되었습니다. 자동 저장이 중단되었습니다.');
            break;
          }

          console.error('[Metadata Autosave] Error saving article:', err);
          if (!navigator.onLine) {
            setSaveStatus('offline');
          } else {
            setSaveStatus('error');
            showToast(`기사 저장 실패: ${err.message || '네트워크를 확인해주세요.'}`);
          }
          break;
        }
      }

      isMetadataSavingRef.current = false;
    }, 800);
  }, [currentUser, isManagerReviewMode, showToast]);


  // Update Article Handler (로컬 state 즉시 반영 + 순수 콘텐츠 변경 시 800ms debounce autosave)
  const handleUpdateArticle = (updated: Article) => {
    if (isManagerReviewMode) return;

    articleRef.current = updated;
    const prev = article;
    setArticle(updated);

    // 순수 콘텐츠 메타데이터 필드 변경 추출 (status 및 업무 필드는 Autosave에서 절대 건드리지 않음)
    const metadataUpdates: Partial<Article> = {};
    if (!prev || prev.title !== updated.title) metadataUpdates.title = updated.title;
    if (!prev || prev.subtitle !== updated.subtitle) metadataUpdates.subtitle = updated.subtitle;
    if (!prev || prev.category !== updated.category) metadataUpdates.category = updated.category;
    if (!prev || prev.tags?.join(',') !== updated.tags?.join(',')) metadataUpdates.tags = updated.tags;
    if (!prev || prev.urgent !== updated.urgent) metadataUpdates.urgent = updated.urgent;
    if (!prev || prev.exclusive !== updated.exclusive) metadataUpdates.exclusive = updated.exclusive;
    if (!prev || prev.embargo !== updated.embargo) metadataUpdates.embargo = updated.embargo;

    if (Object.keys(metadataUpdates).length > 0) {
      scheduleMetadataAutosave(updated, metadataUpdates);
    }
  };

  // 피드백 목록만 화면에 반영 (부장 검토 모드에서도 피드백은 가능해야 하므로 읽기 전용 차단을 받지 않음)
  const handleUpdateFeedbacks = (feedbacks: ArticleFeedback[]) => {
    if (articleRef.current) articleRef.current = { ...articleRef.current, feedbacks };
    setArticle(prev => (prev ? { ...prev, feedbacks } : prev));
  };

  // Manual save (수동 저장)
  const handleManualSave = async () => {
    if (!article || isManagerReviewMode) return;
    try {
      await flushPendingSaves();
      setSaveStatus('saving');
      const updated = await articleService.updateArticle(
        article.id, 
        article, 
        { 
          expectedUpdatedAt: lastKnownUpdatedAtRef.current || undefined,
          contentOnly: true 
        }
      );
      if (updated.updatedAt) {
        lastKnownUpdatedAtRef.current = updated.updatedAt;
      }
      const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      setLastSavedTime(nowStr);
      setSaveStatus('saved');
      showToast('기사가 안전하게 저장되었습니다.');
    } catch (err: any) {
      if (err instanceof ArticleConflictError) {
        setConflictInfo({
          detected: true,
          serverUpdatedAt: err.serverUpdatedAt,
          serverTitle: err.serverTitle,
        });
      }
      setSaveStatus(navigator.onLine ? 'error' : 'offline');
      showToast(`저장 실패: ${err.message || '네트워크를 확인해주세요.'}`);
    }
  };

  // 동시 편집 충돌 시 최신 기사 다시 불러오기
  const handleReloadLatestArticle = async () => {
    if (!article?.id) return;
    try {
      if (metadataTimerRef.current) clearTimeout(metadataTimerRef.current);
      blockTimersRef.current.forEach(t => clearTimeout(t));
      blockTimersRef.current.clear();
      pendingMetadataRef.current = null;
      pendingBlockTextsRef.current.clear();
      // 새 편집기의 저장 안 된 변경은 버리고, 최신 기사로 새로 시작
      bodyControlsRef.current?.discard();
      bodySyncStatesRef.current.clear();
      setBodyEditorEpoch(e => e + 1);

      articleGenerationRef.current++;
      const refreshed = await articleService.getArticleById(article.id);
      setArticle(refreshed);
      lastKnownUpdatedAtRef.current = refreshed.updatedAt || null;
      setConflictInfo(null);
      setSaveStatus('saved');
      showToast('최신 기사 내용을 다시 불러왔습니다.');
    } catch (err: any) {
      showToast(`기사 불러오기 실패: ${err.message}`);
    }
  };

  // Keyboard shortcut for Cmd+S / Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [article, isManagerReviewMode]);





  // 4단계: TXT 기사 가져오기 (import_article_blocks RPC)
  const handleImportTxtBlocks = async (paragraphs: string[], mode: 'replace' | 'append') => {
    if (!article || isManagerReviewMode) return;
    // 새 본문 편집기를 쓰는 중이면 편집기 안에 문단을 넣는다 (저장은 편집기가 자동으로 처리)
    if (bodyEditorActiveRef.current && bodyControlsRef.current) {
      const ok = bodyControlsRef.current.importParagraphs(paragraphs, mode);
      showToast(ok
        ? `TXT 기사 가져오기 완료: ${paragraphs.length}개 문단이 ${mode === 'replace' ? '교체' : '추가'}되었습니다. (자동 저장됩니다)`
        : 'TXT 기사를 가져오지 못했습니다.');
      return;
    }
    if (isBlockedByNewBodyEditor()) return;
    try {
      // 1. Import 전 대기 중인 모든 pending save 플러시 및 타이머 정리 (stale save 방어)
      await flushPendingSaves();

      // 2. 기존 import_article_blocks RPC 실행 (replace mode: boolean)
      await articleBlockService.importTextBlocks(article.id, paragraphs, mode === 'replace');

      // 3. DB에서 생성된 실제 blocks 조회하여 Editor state 동기화 (position_index ASC 보장)
      const updatedBlocks = await articleBlockService.getBlocksByArticleId(article.id);
      setArticle(prev => prev ? {
        ...prev,
        blocks: updatedBlocks,
      } : null);

      showToast(`TXT 기사 가져오기 완료: ${paragraphs.length}개 문단이 ${mode === 'replace' ? '교체' : '추가'}되었습니다.`);
    } catch (err: any) {
      console.error('[App.handleImportTxtBlocks] Error:', err);
      showToast(`TXT 기사 가져오기 실패: ${err.message}`);
    }
  };

  // ==========================================
  // Project Operations
  // ==========================================
  // 새 프로젝트 생성 (create_project_with_initial_article RPC)
  const handleCreateProject = async (newProj: Partial<Project>) => {
    if (blockIfPending()) return;
    try {
      const res = await projectService.createProject({
        name: newProj.name || '새 취재 기획',
        articleTitle: newProj.articleTitle || '제목 없는 기사',
        ...(newProj.coverageType ? { coverageType: newProj.coverageType } : {}),
        ...(newProj.deadline ? { deadline: newProj.deadline } : {}),
      });

      // 프로젝트 목록 새로고침
      await loadProjects();

      // 생성된 기사로 즉시 이동
      await loadArticleForProject(res.projectId);
      pushHistoryState('editor', res.projectId);
      showToast(`새 프로젝트 "${newProj.name}"가 생성되었습니다.`);
    } catch (err: any) {
      console.error('[App.handleCreateProject] Error:', err);
      showToast(`프로젝트 생성 실패: ${err.message}`);
    }
  };

  // 프로젝트 이름/제목 변경
  const handleRenameProject = async (projectId: string, newName: string, newArticleTitle?: string) => {
    if (blockIfPending()) return;
    try {
      await projectService.updateProject(projectId, {
        name: newName,
        articleTitle: newArticleTitle,
      });

      // 프로젝트 목록 새로고침
      await loadProjects();

      // 현재 열려있는 기사가 이 프로젝트라면 이름 동기화
      if (article && article.projectId === projectId) {
        setArticle(prev => prev ? {
          ...prev,
          projectName: newName,
          title: newArticleTitle !== undefined ? newArticleTitle : prev.title,
        } : null);
      }

      showToast(`프로젝트명이 "${newName}"(으)로 변경되었습니다.`);
    } catch (err: any) {
      console.error('[App.handleRenameProject] Error:', err);
      showToast(`프로젝트 이름 변경 실패: ${err.message}`);
    }
  };

  // 프로젝트 삭제
  const handleDeleteProject = async (projectId: string) => {
    if (blockIfPending()) return;
    try {
      await projectService.deleteProject(projectId);
      await loadProjects();

      // 현재 열려있는 기사가 삭제된 프로젝트라면 대시보드로 이동
      if (article && article.projectId === projectId) {
        setArticle(null);
        activeArticleIdRef.current = null;
        setHasSelectedArticle(false);
        setActiveScreen('dashboard');
      }

      showToast('프로젝트가 삭제되었습니다.');
    } catch (err: any) {
      console.error('[App.handleDeleteProject] Error:', err);
      showToast(`프로젝트 삭제 실패: ${err.message}`);
    }
  };

  // 기자 프로필 정보 영구 저장 (DB profiles 테이블 동기화)
  const handleUpdateUserProfile = async (updated: User) => {
    setCurrentUser(updated);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          name: updated.name,
          avatar_url: updated.avatar || null,
          recovery_email: updated.recoveryEmail || null,
        })
        .eq('id', updated.id);

      if (error) {
        console.error('[App.handleUpdateUserProfile] profiles update error:', error);
        showToast('프로필 서버 저장 실패 (로컬 상태만 반영)');
      } else {
        showToast('사용자 프로필이 성공적으로 저장되었습니다.');
      }
    } catch (err: any) {
      console.error('[App.handleUpdateUserProfile] error:', err);
      showToast('프로필 저장 중 오류가 발생했습니다.');
    }
  };

  // 프로젝트 공개 범위 3단계 변경 (visibility: 'private' | 'department' | 'shared')
  const handleUpdateProjectVisibility = async (projectId: string, nextVisibility: ProjectVisibility) => {
    if (blockIfPending()) return;
    try {
      await projectService.toggleShareProject(projectId, nextVisibility);
      await loadProjects();

      if (article && article.projectId === projectId) {
        setArticle(prev => prev ? { ...prev, visibility: nextVisibility } : null);
      }

      const msg = 
        nextVisibility === 'shared' ? '전체 프로젝트에 공유되었습니다.' :
        nextVisibility === 'department' ? '같은 부서에 공유되었습니다.' :
        '비공개(나만 보기)로 변경되었습니다.';
      showToast(msg);
    } catch (err: any) {
      console.error('[App.handleUpdateProjectVisibility] Error:', err);
      showToast(`공개 범위 변경 실패: ${err.message}`);
    }
  };

  // 에디터에서 기사 상태 변경 시 DB 저장 및 projects 목록과 article 실시간 동기화
  const handleUpdateArticleStatus = async (newStatus: ArticleStatus) => {
    if (blockIfPending()) return;
    if (!article) return;
    try {
      await articleService.updateArticleStatus(article.id, newStatus);
      setArticle(prev => prev ? { ...prev, status: newStatus } : null);
      setProjects(prev => prev.map(p => 
        p.id === article.projectId ? { ...p, status: newStatus as any } : p
      ));
      showToast('기사 상태가 변경되었습니다.');
    } catch (err: any) {
      console.error('[App.handleUpdateArticleStatus] Failed:', err);
      showToast(`기사 상태 저장 실패: ${err.message}`);
    }
  };

  // 대시보드에서 프로젝트(기사) 상태 즉시 변경
  const handleUpdateProjectStatus = async (projectId: string, nextStatus: string) => {
    if (blockIfPending()) return;
    try {
      await projectService.updateProjectStatus(projectId, nextStatus);
      setProjects(prev => prev.map(p => 
        p.id === projectId ? { ...p, status: nextStatus as any } : p
      ));
      if (article && article.projectId === projectId) {
        setArticle(prev => prev ? { ...prev, status: nextStatus as any } : null);
      }
      await loadProjects();
      showToast('기사 상태가 변경되었습니다.');
    } catch (err: any) {
      console.error('[App.handleUpdateProjectStatus] Error:', err);
      showToast(`기사 상태 변경 실패: ${err.message}`);
    }
  };

  // 프로젝트 전체 공유 토글 (하위 호환)
  const handleToggleShareProject = async (projectId: string) => {
    if (blockIfPending()) return;
    const target = projects.find(p => p.id === projectId);
    if (!target) return;
    const nextVisibility = target.visibility === 'shared' ? 'private' : 'shared';
    await handleUpdateProjectVisibility(projectId, nextVisibility);
  };

  // 브라우저 History State 연동 헬퍼 (URL Hash 동기화로 브라우저 뒤로/앞으로 및 이탈 방어)
  const pushHistoryState = useCallback((
    screen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media',
    projectId?: string,
    articleId?: string
  ) => {
    try {
      const currentState = window.history.state;
      if (currentState?.screen === screen && currentState?.projectId === projectId && currentState?.articleId === articleId) {
        return;
      }
      // 편집기에서 뒤로가기·새로고침 하면 '프로젝트 관리' 목록으로 돌아오도록 기억
      if (screen === 'editor') {
        try { window.sessionStorage.setItem('press-cms-dashboard-view', 'projects'); } catch { /* 무시 */ }
      }
      const hash = screen === 'editor' && projectId ? `#/editor/${projectId}` : `#/${screen}`;
      window.history.pushState({ screen, projectId, articleId }, '', hash);
    } catch {
      // ignore
    }
  }, []);

  // 대시보드에서 프로젝트 선택 시 실제 DB 기사 로드
  const handleSelectProject = async (projectId: string, skipHistory = false) => {
    if (article && article.projectId === projectId) {
      setHasSelectedArticle(true);
      setActiveScreen('editor');
      if (!skipHistory) {
        pushHistoryState('editor', projectId, article.id);
      }
      return;
    }
    // 기사 전환 전 대기 중인 모든 변경사항 flush 완료 (race condition 및 데이터 유실 방어)
    try {
      await flushPendingSaves();
    } catch (err: any) {
      console.warn('[App.handleSelectProject] Flush failed before switch:', err);
      showToast('저장되지 않은 변경사항이 있어 프로젝트를 전환할 수 없습니다. 저장 상태를 확인해주세요.');
      return;
    }
    await loadArticleForProject(projectId);
    if (!skipHistory) {
      pushHistoryState('editor', projectId);
    }
  };

  // 알림 클릭 시 해당 기사/프로젝트 Editor로 바로 이동
  const handleNotificationSelectArticle = async (_articleId: string, projectId?: string) => {
    if (projectId) {
      await handleSelectProject(projectId);
    } else {
      const found = projects.find(p => p.id);
      if (found) {
        await handleSelectProject(found.id);
      }
    }
  };

  // ==========================================
  // Publish Operation (Preflight & publish_article RPC)
  // ==========================================
  const handleOpenPublish = async () => {
    if (blockIfPending()) return;
    if (!article) return;
    try {
      await flushPendingSaves();
      setIsPublishModalOpen(true);
    } catch (err: any) {
      console.error('[App.handleOpenPublish] Flush pending saves failed:', err);
      showToast(`출고 전 임시 저장 실패: ${err.message || '저장되지 않아 출고 모달을 열 수 없습니다.'}`);
    }
  };

  const handleConfirmPublish = async (channels: string[]) => {
    if (!article) return;
    try {
      await flushPendingSaves();
      const res = await articleService.publishArticle(article.id, channels);
      if (res.success) {
        setArticle(prev => prev ? {
          ...prev,
          status: 'published',
          publishDestinations: channels,
        } : null);
        await loadProjects();
        setNotificationTrigger(prev => prev + 1);
        showToast('기사가 성공적으로 최종 출고되었습니다!');
      }
    } catch (err: any) {
      console.error('[App.handleConfirmPublish] Publish error:', err);
      showToast(`기사 출고 실패: ${err.message}`);
      throw err; // 오류를 삼키지 않고 전파하여 출고 프로세스 중단
    }
  };

  // ==========================================
  // Mock Features Handlers (AI Review, Feedback, Media, Version History)
  // AI 원문 자동 수정 로직 제거: 기자의 원문은 AI가 임의로 replace하지 않음
  // ==========================================
  const handleResolveReview = (reviewId: string) => {
    if (!article) return;
    const newReviews = article.aiReviews.map(r => 
      r.id === reviewId ? { ...r, status: 'resolved' as const } : r
    );
    const newBlocks = article.blocks.map(blk => 
      blk.aiReviewId === reviewId ? { ...blk, highlightedText: undefined } : blk
    );
    handleUpdateArticle({ ...article, blocks: newBlocks, aiReviews: newReviews });
    showToast('검수 항목 확인이 완료되었습니다.');
  };

  const handleIgnoreReview = (reviewId: string) => {
    if (!article) return;
    const newReviews = article.aiReviews.map(r => 
      r.id === reviewId ? { ...r, status: 'ignored' as const } : r
    );
    const newBlocks = article.blocks.map(blk => 
      blk.aiReviewId === reviewId ? { ...blk, highlightedText: undefined } : blk
    );
    handleUpdateArticle({ ...article, blocks: newBlocks, aiReviews: newReviews });
    showToast('검수 항목을 무시 처리했습니다.');
  };

  const handleUndoReview = (reviewId: string) => {
    if (!article) return;
    const rev = article.aiReviews.find(r => r.id === reviewId);
    // 원문 텍스트는 임의로 건드리지 않고, 하이라이트 표시 및 검수 상태만 대기로 복원
    let newBlocks = article.blocks;
    if (rev && rev.sourceText) {
      newBlocks = article.blocks.map(blk => {
        if (blk.id === rev.blockId) {
          return {
            ...blk,
            highlightedText: rev.sourceText,
          };
        }
        return blk;
      });
    }
    const newReviews = article.aiReviews.map(r => 
      r.id === reviewId ? { ...r, status: 'pending' as const } : r
    );
    handleUpdateArticle({ ...article, blocks: newBlocks, aiReviews: newReviews });
    showToast('검토 항목을 대기 상태로 되돌렸습니다.');
  };

  const handleRunAiScan = async () => {
    if (!article) return;

    if (isAiScanning) {
      showToast('이미 AI 검수가 진행 중입니다.');
      return;
    }

    const remaining = aiReviewService.getRemainingCooldownSeconds();
    if (remaining > 0) {
      setScanCooldownSeconds(remaining);
      showToast(`AI 검수 재실행 쿨다운 중입니다. (${remaining}초 후 가능)`);
      return;
    }

    setIsAiScanning(true);
    setSaveStatus('saving');

    try {
      // 1. 현재 대기 중인 모든 메타데이터 및 본문 블록 수정을 DB에 즉시 플러시 & 저장
      await flushPendingSaves();
      setSaveStatus('saved');

      // 2. Edge Function 호출하여 DB에 저장된 최신 기사 기반 Gemini AI 검수 실행
      showToast('기사 저장 완료. AI 검수를 시작합니다...');
      const reviews = await aiReviewService.runAiScan(article.id);

      // 3. 기사 원문(blocks)은 절대 변경하지 않고 aiReviews state만 업데이트
      setArticle(prev => prev ? { ...prev, aiReviews: reviews } : null);

      // 4. 쿨다운 5초 시작
      setScanCooldownSeconds(5);
      showToast(`AI 기사 검수가 완료되었습니다. (${reviews.length}건 검토 제안)`);
    } catch (err: any) {
      console.error('[handleRunAiScan] Error during AI scan:', err);
      showToast(`AI 검수 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsAiScanning(false);
    }
  };

  const handleAddFeedback = async (newFb: Omit<ArticleFeedback, 'id' | 'createdAt' | 'replies'>) => {
    if (blockIfPending()) return;
    if (!article) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const tempId = `fb_${Date.now()}`;
    const item: ArticleFeedback = {
      ...newFb,
      id: tempId,
      createdAt: timeStr,
      replies: [],
    };
    handleUpdateFeedbacks([item, ...(article.feedbacks || [])]);
    showToast('새 피드백 메모가 등록되었습니다.');

    try {
      const created = await feedbackService.createFeedback(article.id, {
        content: newFb.content,
        blockId: newFb.blockId,
        authorId: currentUser?.id,
        selectedText: newFb.selectedText,
        contextBefore: newFb.contextBefore,
        contextAfter: newFb.contextAfter,
        startOffset: newFb.startOffset,
        endOffset: newFb.endOffset,
        color: newFb.color,
      });
      setArticle(prev => {
        if (!prev) return null;
        const updated = (prev.feedbacks || []).map(f => f.id === tempId ? { ...f, id: created.id } : f);
        return { ...prev, feedbacks: updated };
      });
    } catch (err: any) {
      console.error('[App.handleAddFeedback] DB error:', err);
    }
  };

  const handleAddReply = (feedbackId: string, reply: Omit<FeedbackReply, 'id' | 'createdAt'>) => {
    if (blockIfPending()) return;
    if (!article) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newReplyItem: FeedbackReply = {
      ...reply,
      id: `rep_${Date.now()}`,
      createdAt: timeStr,
    };
    const updatedFeedbacks = (article.feedbacks || []).map(fb => 
      fb.id === feedbackId ? { ...fb, replies: [...(fb.replies || []), newReplyItem] } : fb
    );
    handleUpdateFeedbacks(updatedFeedbacks);
    showToast('답글이 등록되었습니다.');
  };

  const handleToggleResolveFeedback = async (feedbackId: string) => {
    if (blockIfPending()) return;
    if (!article) return;
    let resolvedState = false;
    const updatedFeedbacks = (article.feedbacks || []).map(fb => {
      if (fb.id === feedbackId) {
        resolvedState = !fb.isResolved;
        return { ...fb, isResolved: resolvedState };
      }
      return fb;
    });
    handleUpdateFeedbacks(updatedFeedbacks);
    showToast(resolvedState ? '피드백이 "해결됨"으로 처리되었습니다.' : '피드백이 "미해결" 상태로 변경되었습니다.');

    try {
      await feedbackService.toggleResolve(feedbackId, resolvedState, currentUser?.id);
    } catch (err: any) {
      console.error('[App.handleToggleResolveFeedback] DB error:', err);
    }
  };

  const handleEditFeedback = async (feedbackId: string, newContent: string) => {
    if (blockIfPending()) return;
    if (!article) return;
    const updated = (article.feedbacks || []).map(fb => 
      fb.id === feedbackId ? { ...fb, content: newContent, updatedAt: new Date().toLocaleTimeString() } : fb
    );
    handleUpdateFeedbacks(updated);
    showToast('피드백이 수정되었습니다.');

    try {
      await feedbackService.updateFeedback(feedbackId, newContent);
    } catch (err: any) {
      console.error('[App.handleEditFeedback] DB error:', err);
    }
  };

  const handleDeleteFeedback = async (feedbackId: string) => {
    if (blockIfPending()) return;
    if (!article) return;
    const updated = (article.feedbacks || []).filter(fb => fb.id !== feedbackId);
    handleUpdateFeedbacks(updated);
    showToast('피드백이 삭제되었습니다.');

    try {
      await feedbackService.deleteFeedback(feedbackId);
    } catch (err: any) {
      console.error('[App.handleDeleteFeedback] DB error:', err);
    }
  };

  const handleToggleFeedbackReaction = (feedbackId: string, type: ReactionType) => {
    if (blockIfPending()) return;
    if (!article || !currentUser) return;
    const updated = (article.feedbacks || []).map(fb => {
      if (fb.id === feedbackId) {
        const reactions = fb.reactions ? [...fb.reactions] : [];
        const existingIdx = reactions.findIndex(r => r.type === type);
        if (existingIdx !== -1) {
          const item = reactions[existingIdx];
          const hasUser = item.userIds.includes(currentUser.id);
          const newUserIds = hasUser 
            ? item.userIds.filter(id => id !== currentUser.id)
            : [...item.userIds, currentUser.id];
          if (newUserIds.length === 0) reactions.splice(existingIdx, 1);
          else reactions[existingIdx] = { ...item, userIds: newUserIds };
        } else {
          reactions.push({ type, userIds: [currentUser.id] });
        }
        return { ...fb, reactions };
      }
      return fb;
    });
    handleUpdateFeedbacks(updated);
  };

  const handleToggleReplyReaction = (feedbackId: string, replyId: string, type: ReactionType) => {
    if (blockIfPending()) return;
    if (!article || !currentUser) return;
    const updated = (article.feedbacks || []).map(fb => {
      if (fb.id === feedbackId) {
        const replies = (fb.replies || []).map(reply => {
          if (reply.id === replyId) {
            const reactions = reply.reactions ? [...reply.reactions] : [];
            const existingIdx = reactions.findIndex(r => r.type === type);
            if (existingIdx !== -1) {
              const item = reactions[existingIdx];
              const hasUser = item.userIds.includes(currentUser.id);
              const newUserIds = hasUser 
                ? item.userIds.filter(id => id !== currentUser.id)
                : [...item.userIds, currentUser.id];
              if (newUserIds.length === 0) reactions.splice(existingIdx, 1);
              else reactions[existingIdx] = { ...item, userIds: newUserIds };
            } else {
              reactions.push({ type, userIds: [currentUser.id] });
            }
            return { ...reply, reactions };
          }
          return reply;
        });
        return { ...fb, replies };
      }
      return fb;
    });
    handleUpdateFeedbacks(updated);
  };

  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [highlightedText, setHighlightedText] = useState<string | null>(null);

  const focusArticleBlock = (blockId: string, options?: { highlightBlock?: boolean; highlightText?: string }) => {
    const el = document.getElementById(`article-block-${blockId}`) || 
               document.querySelector(`[data-block-id="${blockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedBlockId(blockId);
      if (options?.highlightText) {
        setHighlightedText(options.highlightText);
      } else {
        setHighlightedText(null);
      }
      setTimeout(() => {
        setHighlightedBlockId(prev => (prev === blockId ? null : prev));
        setHighlightedText(null);
      }, 2000);
    }
  };

  const handleInsertMediaAt = async (media: MediaItem, targetIndex: number) => {
    if (!article) return;
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 기사에 미디어를 삽입할 수 없습니다.');
      return;
    }
    // 새 본문 편집기를 쓰는 중이면 편집기 안에 사진/영상을 넣는다 (저장은 편집기가 자동으로 처리)
    if (bodyEditorActiveRef.current && bodyControlsRef.current) {
      // 저장된 블록 수 이상의 번호는 "맨 끝"으로 본다 (아래쪽 [보도사진 삽입] 버튼, 파일 끌어다 놓기 등)
      const where: number | 'end' = targetIndex >= article.blocks.length ? 'end' : targetIndex;
      const ok = bodyControlsRef.current.insertMedia([mediaItemToBodyAttrs(media)], where);
      showToast(ok
        ? `"${media.title.slice(0, 15)}..." 미디어를 기사에 삽입했습니다. (자동 저장됩니다)`
        : '미디어를 삽입하지 못했습니다.');
      return;
    }
    if (isBlockedByNewBodyEditor()) return;

    // [중요] DB 영속 저장소에는 만료되는 Signed URL이 아닌 영속 storage reference를 저장
    const persistentReference = media.storagePath || media.url;

    try {
      const createdBlock = await articleBlockService.insertMediaBlockAt(
        article.id,
        {
          type: media.type === 'video' ? 'video' : 'image',
          mediaUrl: persistentReference,
          caption: media.caption || media.captionSuggestion || `▲ ${media.title}`,
          credit: media.credit || '기자 본인 촬영',
          mediaType: media.type,
          fileFormat: media.format,
          fileSize: media.fileSize,
        },
        targetIndex
      );

      // React 런타임 렌더링용 임시 Signed URL 주입 (DB 저장 안 됨)
      if (!createdBlock.runtimeMediaUrl && media.url) {
        createdBlock.runtimeMediaUrl = media.url;
      }

      const newBlocks = [...article.blocks];
      newBlocks.splice(targetIndex, 0, createdBlock);
      const reindexed = newBlocks.map((b, idx) => ({ ...b, sortOrder: idx }));
      setArticle({ ...article, blocks: reindexed });
      showToast(`"${media.title.slice(0, 15)}..." 미디어를 기사에 삽입했습니다.`);
    } catch (err: any) {
      console.error('[App.handleInsertMediaAt] Error:', err);
      showToast(err.message || '미디어 블록 삽입에 실패했습니다.');
    }
  };

  const handleInsertMediaEnd = (media: MediaItem) => {
    if (!article) return;
    handleInsertMediaAt(media, article.blocks.length);
  };


  /**
   * 외부 이미지 파일 드래그 앤 드롭 업로드 및 기사 본문 블록 삽입 핸들러
   */
  const handleUploadAndInsertMedia = useCallback(async (files: File[], targetIndex?: number) => {
    if (!article || isManagerReviewMode) return;
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    // 인포그래픽이 아닌 일반 사진은 올리기 창(제목·캡션 입력)으로 보냄
    const plain = imageFiles.filter(f => !f.name.startsWith('인포그래픽_'));
    if (plain.length > 0 && plain.length === imageFiles.length) {
      setRightPanelTab('media');
      setIsRightPanelOpen(true);
      setExternalUploadFiles(plain);
      return;
    }

    try {
      showToast(`${imageFiles.length}개 이미지 업로드 중...`);
      let insertPos = targetIndex ?? article.blocks.length;

      for (const file of imageFiles) {
        // 1. MediaService를 통한 Storage 업로드 및 DB 레코드 생성
        const isInfographic = file.name.startsWith('인포그래픽_');
        const uploadedItem = await mediaService.uploadMedia(
          article.projectId,
          file,
          isInfographic
            ? { credit: 'PRESS-CMS 인포그래픽', caption: '▲ 기사 속 숫자를 정리한 인포그래픽' }
            : { credit: '기자 본인 촬영' }
        );

        // 2. 기사 본문에 이미지 블록 생성 및 삽입
        await handleInsertMediaAt(uploadedItem, insertPos);
        insertPos++;
      }
    } catch (err: any) {
      console.error('[App.handleUploadAndInsertMedia] Error:', err);
      showToast(`이미지 드래그 앤 드롭 업로드 실패: ${err.message}`);
    }
  }, [article, isManagerReviewMode, showToast]);

  const handleInsertMultipleMedia = async (items: MediaItem[]) => {
    if (!article || items.length === 0) return;
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 기사에 미디어를 삽입할 수 없습니다.');
      return;
    }
    // 새 본문 편집기를 쓰는 중이면 글 쓰던 자리 다음(없으면 맨 끝)에 한꺼번에 넣는다
    if (bodyEditorActiveRef.current && bodyControlsRef.current) {
      const ok = bodyControlsRef.current.insertMedia(items.map(mediaItemToBodyAttrs), 'cursor');
      showToast(ok
        ? `${items.length}개 미디어가 기사에 삽입되었습니다. (자동 저장됩니다)`
        : '미디어를 삽입하지 못했습니다.');
      return;
    }
    if (isBlockedByNewBodyEditor()) return;

    try {
      let startIndex = article.blocks.length;
      const createdBlocks: ArticleBlock[] = [];
      for (const media of items) {
        // DB 영속 필드에는 storagePath만 저장
        const persistentReference = media.storagePath || media.url;
        const created = await articleBlockService.createBlock(
          article.id,
          {
            type: media.type === 'video' ? 'video' : 'image',
            mediaUrl: persistentReference,
            caption: media.caption || media.captionSuggestion || `▲ ${media.title}`,
            credit: media.credit || '기자 본인 촬영',
            mediaType: media.type,
            fileFormat: media.format,
            fileSize: media.fileSize,
          },
          startIndex++
        );
        if (!created.runtimeMediaUrl && media.url) {
          created.runtimeMediaUrl = media.url;
        }
        createdBlocks.push(created);
      }
      setArticle(prev => prev ? { ...prev, blocks: [...prev.blocks, ...createdBlocks] } : null);
      showToast(`${items.length}개 미디어가 기사에 삽입되었습니다.`);
    } catch (err: any) {
      console.error('[App.handleInsertMultipleMedia] Error:', err);
      showToast(err.message || '미디어 블록 삽입에 실패했습니다.');
    }
  };

  // 5단계: 실제 Supabase Storage + media 테이블 파일 업로드
  const handleUploadFiles = async (files: File[]) => {
    if (!article?.projectId) {
      showToast('선택된 프로젝트가 없어 미디어를 업로드할 수 없습니다.');
      return;
    }
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 미디어를 업로드할 수 없습니다.');
      return;
    }
    try {
      const uploadPromises = files.map(file => mediaService.uploadMedia(article.projectId, file));
      const uploadedItems = await Promise.all(uploadPromises);
      setMediaLibrary(prev => [...uploadedItems, ...prev]);
      showToast(`${uploadedItems.length}개의 미디어가 성공적으로 업로드되었습니다.`);

      // 6단계: 이미지 파일에 대해 비동기 AI 분석 자동 시작 (업로드와 분리된 독립 라이프사이클)
      uploadedItems.forEach(item => {
        if (item.type === 'image') {
          handleAnalyzeMedia(item.id, false).catch(err => {
            console.warn(`[App.handleUploadFiles] Background AI analysis skipped/failed for ${item.id}:`, err?.message);
          });
        }
      });
    } catch (err: any) {
      console.error('[App.handleUploadFiles] Error:', err);
      showToast(err.message || '미디어 업로드에 실패했습니다.');
      throw err;
    }
  };

  // 6단계: 미디어 이미지 AI 분석/재분석 핸들러
  const handleAnalyzeMedia = async (mediaId: string, force = false) => {
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 AI 분석을 실행할 수 없습니다.');
      return;
    }

    // UI 상태를 즉시 'analyzing'으로 마킹
    setMediaLibrary(prev => prev.map(m => m.id === mediaId ? { ...m, aiAnalysisStatus: 'analyzing' } : m));

    try {
      const updatedItem = await mediaService.analyzeMediaImage(mediaId, force);
      setMediaLibrary(prev => prev.map(m => m.id === mediaId ? updatedItem : m));
      showToast('미디어 AI 분석이 완료되었습니다.');
    } catch (err: any) {
      console.error('[App.handleAnalyzeMedia] Error:', err);
      // 실패 시 UI 상태 'failed'로 동기화
      setMediaLibrary(prev => prev.map(m => m.id === mediaId ? { ...m, aiAnalysisStatus: 'failed' } : m));
      showToast(err.message || 'AI 이미지 분석에 실패했습니다.');
      throw err;
    }
  };

  // 5단계: 실제 media 테이블 메타데이터 수정 (캡션/크레딧)
  const handleUpdateMedia = async (mediaId: string, updates: { caption?: string; credit?: string }) => {
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 미디어 정보를 수정할 수 없습니다.');
      return;
    }
    try {
      await mediaService.updateMedia(mediaId, updates);
      setMediaLibrary(prev => prev.map(m => (m.id === mediaId ? { ...m, ...updates } : m)));
      showToast('미디어 메타데이터가 수정되었습니다.');
    } catch (err: any) {
      console.error('[App.handleUpdateMedia] Error:', err);
      showToast(err.message || '미디어 메타데이터 수정에 실패했습니다.');
      throw err;
    }
  };

  // 5단계: 실제 media 삭제 (기사 참조 여부 검증 후 Storage + DB 삭제)
  const handleDeleteMedia = async (item: MediaItem) => {
    if (isManagerReviewMode) {
      showToast('부장 검토 모드에서는 미디어를 삭제할 수 없습니다.');
      return;
    }
    try {
      await mediaService.deleteMedia(item, article?.blocks || []);
      setMediaLibrary(prev => prev.filter(m => m.id !== item.id));
      showToast('미디어가 안전하게 삭제되었습니다.');
    } catch (err: any) {
      console.error('[App.handleDeleteMedia] Error:', err);
      showToast(err.message || '미디어 삭제에 실패했습니다.');
      throw err;
    }
  };

  // 기사 신규 버전 수동 저장
  const handleCreateVersion = async (summary?: string) => {
    if (blockIfPending()) return;
    if (!article) return;
    try {
      setIsLoadingVersions(true);
      // Autosave race condition 방지: 대기 중인 모든 autosave를 선행 flush
      try {
        await flushPendingSaves();
      } catch (flushErr: any) {
        console.error('[App.handleCreateVersion] flushPendingSaves failed:', flushErr);
        showToast('변경사항을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      await articleVersionService.createVersion(article.id, summary);
      await loadArticleVersions(article.id);
      showToast('새 버전이 성공적으로 저장되었습니다.');
    } catch (err: any) {
      console.error('[App.handleCreateVersion] Error:', err);
      showToast(`버전 저장 실패: ${err.message}`);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  // 과거 버전 복원 (원자적 RPC: 백업 -> 복원 -> 이력 기록)
  const handleRestoreSnapshot = async (snap: VersionSnapshot) => {
    if (blockIfPending()) return;
    if (!article) return;
    try {
      setIsRestoringVersion(true);
      // 1. 대기 중인 autosave 즉시 flush하여 타이핑 내용 덮어쓰기 레이스 차단
      try {
        await flushPendingSaves();
      } catch (flushErr: any) {
        console.error('[App.handleRestoreSnapshot] flushPendingSaves failed:', flushErr);
        showToast('변경사항을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      // 2. DB RPC 실행 (현재 상태 백업 생성 -> 복원 -> 복원 기록 새 버전 생성)
      await articleVersionService.restoreVersion(snap.id);

      // 세대 번호 증가 및 이전 대기 큐 완전 무효화 (오래된 autosave가 복원 내용을 덮어쓰는 사고 방지)
      articleGenerationRef.current++;
      if (metadataTimerRef.current) clearTimeout(metadataTimerRef.current);
      blockTimersRef.current.forEach(t => clearTimeout(t));
      blockTimersRef.current.clear();
      pendingMetadataRef.current = null;
      pendingBlockTextsRef.current.clear();

      // 3. 복원된 기사 메타데이터 및 본문 블록 전체를 DB로부터 새로 동기화
      const refreshed = await articleService.getArticleById(article.id);
      setArticle(refreshed);
      lastKnownUpdatedAtRef.current = refreshed.updatedAt || null;
      setConflictInfo(null);
      setLastSavedTime(refreshed.lastSaved || '방금 전');
      setSaveStatus('saved');

      // 4. 버전 목록 최신화
      await loadArticleVersions(article.id);

      showToast(`버전 "v${snap.versionNumber ?? snap.timestamp}"(으)로 성공적으로 복원되었습니다.`);
      setIsHistoryModalOpen(false);
    } catch (err: any) {
      console.error('[App.handleRestoreSnapshot] Error:', err);
      showToast(`버전 복원 실패: ${err.message}`);
    } finally {
      setIsRestoringVersion(false);
    }
  };

  // 수정이력(버전) 삭제
  const handleDeleteSnapshot = async (snap: VersionSnapshot) => {
    if (blockIfPending()) return;
    if (!article) return;
    try {
      setIsLoadingVersions(true);
      await articleVersionService.deleteVersion(snap.id);
      await loadArticleVersions(article.id);
      showToast(`수정이력 "v${snap.versionNumber ?? snap.timestamp}"을(를) 삭제했습니다.`);
    } catch (err: any) {
      console.error('[App.handleDeleteSnapshot] Error:', err);
      showToast(`이력 삭제 실패: ${err.message}`);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  // ==========================================
  // Article Review Workflow Handlers
  // ==========================================

  // 기자: 검토 요청 / 재검토 요청
  const handleRequestReview = async () => {
    if (!article) return;
    try {
      setIsWorkflowLoading(true);
      // Autosave flush 완료 확인 (실패 시 중단)
      try {
        await flushPendingSaves();
      } catch (flushErr: any) {
        console.error('[App.handleRequestReview] flushPendingSaves failed:', flushErr);
        showToast('변경사항을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      const isReReview = article.status === 'changes_requested';
      const updated = await articleWorkflowService.requestReview(article.id);
      setArticle(updated);
      lastKnownUpdatedAtRef.current = updated.updatedAt || null;
      await loadArticleVersions(article.id);
      await loadProjects();
      setNotificationTrigger(prev => prev + 1);
      showToast(isReReview ? '재검토를 요청했습니다.' : '검토를 요청했습니다.');
    } catch (err: any) {
      console.error('[App.handleRequestReview] Error:', err);
      showToast(`검토 요청 실패: ${err.message}`);
    } finally {
      setIsWorkflowLoading(false);
    }
  };

  // 데스크: 기사 수정 요청
  const handleRequestChanges = async (reason: string) => {
    if (!article) return;
    try {
      setIsWorkflowLoading(true);
      // 대기 중인 autosave 저장 확인 (실패 시 차단)
      try {
        await flushPendingSaves();
      } catch (flushErr: any) {
        console.error('[App.handleRequestChanges] flushPendingSaves failed:', flushErr);
        showToast('기사 변경사항을 저장하지 못해 수정 요청을 진행할 수 없습니다.');
        return;
      }

      const updated = await articleWorkflowService.requestChanges(article.id, reason);
      setArticle(updated);
      lastKnownUpdatedAtRef.current = updated.updatedAt || null;
      await loadArticleVersions(article.id);
      await loadProjects();
      setNotificationTrigger(prev => prev + 1);
      showToast('수정을 요청했습니다.');
    } catch (err: any) {
      console.error('[App.handleRequestChanges] Error:', err);
      showToast(`수정 요청 실패: ${err.message}`);
    } finally {
      setIsWorkflowLoading(false);
    }
  };

  // 데스크: 기사 승인 (출고 대기 전환)
  const handleApproveArticle = async () => {
    if (!article) return;
    try {
      setIsWorkflowLoading(true);
      // 대기 중인 autosave 저장 확인 (실패 시 차단)
      try {
        await flushPendingSaves();
      } catch (flushErr: any) {
        console.error('[App.handleApproveArticle] flushPendingSaves failed:', flushErr);
        showToast('기사 변경사항을 저장하지 못해 승인을 진행할 수 없습니다.');
        return;
      }

      const updated = await articleWorkflowService.approveArticle(article.id);
      setArticle(updated);
      lastKnownUpdatedAtRef.current = updated.updatedAt || null;
      await loadArticleVersions(article.id);
      await loadProjects();
      setNotificationTrigger(prev => prev + 1);
      showToast('기사를 승인했습니다.');
    } catch (err: any) {
      console.error('[App.handleApproveArticle] Error:', err);
      showToast(`기사 승인 실패: ${err.message}`);
    } finally {
      setIsWorkflowLoading(false);
    }
  };

  // 화면 전환 핸들러 (Editor에서 다른 화면으로 이탈 시 미저장 변경사항 flush 및 실패 시 전환 차단)
  const handleNavigate = async (screen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide' | 'media', skipHistory = false) => {
    if (screen === 'editor' && !hasSelectedArticle) {
      showToast('편집할 프로젝트를 먼저 대시보드에서 선택해주세요.');
      return;
    }
    if (activeScreen === 'editor' && screen !== 'editor') {
      try {
        await flushPendingSaves();
      } catch (err: any) {
        console.warn('[App.handleNavigate] Flush failed before screen change:', err);
        showToast('저장되지 않은 변경사항이 있어 화면을 전환할 수 없습니다. 저장 상태를 확인해주세요.');
        return;
      }
    }
    setActiveScreen(screen);
    if (!skipHistory) {
      pushHistoryState(screen, article?.projectId, article?.id);
    }
  };

  // 미디어 라이브러리에서 [기사에 넣기]
  const handleLibraryInsert = (items: MediaItem[]) => {
    if (!article || !hasSelectedArticle || isManagerReviewMode) {
      showToast('기사를 연 상태에서만 사진을 넣을 수 있습니다.');
      return;
    }
    // 편집기가 이미 열려 있으면 글 쓰던 자리에 바로 넣고 창을 닫음
    if (activeScreen === 'editor' && bodyEditorActiveRef.current && bodyControlsRef.current) {
      handleInsertMultipleMedia(items);
      return;
    }
    // 미디어 탭에서 누른 경우: 편집기로 이동한 뒤 맨 아래에 넣음
    pendingInsertRef.current = items;
    setIsMediaDrawerOpen(false);
    handleNavigate('editor');
  };

  // 편집기 밖으로 나가면 미디어 창도 함께 닫음
  useEffect(() => {
    if (activeScreen !== 'editor') setIsMediaDrawerOpen(false);
  }, [activeScreen]);

  // 사진 올릴 때 고를 수 있는 프로젝트 (내가 만든 프로젝트)
  const uploadableProjects = projects
    .filter(p => !p.ownerId || !currentUser || p.ownerId === currentUser.id)
    .map(p => ({ id: p.id, name: p.name }));

  // 사진 일부 가리기로 만든 새 사진을 보관할 곳 (내 기사 프로젝트면 거기에, 아니면 라이브러리에)
  useEffect(() => {
    setBlurUploadConfig({
      projectId: article?.projectId && uploadableProjects.some(p => p.id === article.projectId) ? article.projectId : null,
      uploader: { name: currentUser?.name, email: currentUser?.email, department: currentUser?.department },
    });
  });

  // Browser History (popstate) 이벤트 핸들러: 뒤로가기 / 앞으로가기 지원
  useEffect(() => {
    const initialHash = window.location.hash.replace(/^#\/?/, '');
    if (initialHash.startsWith('editor')) {
      try { window.sessionStorage.setItem('press-cms-dashboard-view', 'projects'); } catch { /* 무시 */ }
    }
    const initialScreen = initialHash.startsWith('editor') ? 'editor' : (
      ['dashboard', 'preview', 'settings', 'hr', 'guide', 'media'].includes(initialHash) ? initialHash as any : activeScreen
    );

    if (!window.history.state) {
      const hash = initialScreen === 'editor' && article?.projectId ? `#/editor/${article.projectId}` : `#/${initialScreen}`;
      window.history.replaceState(
        { screen: initialScreen, projectId: article?.projectId, articleId: article?.id },
        '',
        hash
      );
    }

    const onPopState = async (e: PopStateEvent) => {
      const state = e.state;
      let targetScreen = state?.screen;
      let targetProjectId = state?.projectId;

      // state가 없는 경우 URL Hash 기반 복구
      if (!targetScreen) {
        const hash = window.location.hash.replace(/^#\/?/, '');
        if (hash.startsWith('editor/')) {
          targetScreen = 'editor';
          targetProjectId = hash.split('/')[1];
        } else if (hash === 'editor') {
          targetScreen = 'editor';
        } else if (['dashboard', 'preview', 'settings', 'hr', 'guide', 'media'].includes(hash)) {
          targetScreen = hash as any;
        } else {
          targetScreen = 'dashboard';
        }
      }

      // 에디터 화면에서 다른 화면으로 뒤로/앞으로 갈 때 미저장 변경사항 안전 flush
      if (activeScreen === 'editor' && targetScreen !== 'editor') {
        try {
          await flushPendingSaves();
        } catch (flushErr) {
          console.warn('[popstate] flushPendingSaves failed:', flushErr);
        }
      }

      if (targetScreen === 'editor' && targetProjectId) {
        if (article?.projectId !== targetProjectId) {
          await loadArticleForProject(targetProjectId);
        } else {
          setHasSelectedArticle(true);
          setActiveScreen('editor');
        }
      } else {
        setActiveScreen(targetScreen);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeScreen, article?.projectId, article?.id, loadArticleForProject, flushPendingSaves]);

  const unresolvedAiCount = article ? article.aiReviews.filter(r => r.status === 'pending').length : 0;
  const unresolvedFeedbackCount = article ? (article.feedbacks || []).filter(f => !f.isResolved).length : 0;

  // 0. Auth 세션 확인 중 로딩 화면
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex flex-col justify-center items-center p-4 select-none text-slate-100">
        <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md mb-4 animate-pulse">
          <Newspaper className="w-6 h-6" />
        </div>
        <div className="flex items-center space-x-2 text-sm font-semibold text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>사용자 인증 확인 중...</span>
        </div>
      </div>
    );
  }

  // If not logged in, render Login View
  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          currentUserIdRef.current = user.id;
          resetSessionUI();
          setActiveScreen(isHrAdmin(user) ? 'hr' : 'dashboard');
          setCurrentUser(user);
          showToast(`${user.name} 님으로 로그인되었습니다.`);
          if (!isHrAdmin(user)) {
            loadProjects();
          }
        }}
      />
    );
  }

  // 인사부 관리자 전용 워크스페이스 (뉴스룸 접근 차단)
  if (isHrAdmin(currentUser)) {
    return (
      <div className="h-screen w-screen flex flex-col bg-slate-900 overflow-hidden font-sans text-slate-100">
        <TopHeader
          article={article || {
            id: '',
            projectId: '',
            projectName: '인사 관리 포털',
            title: '',
            subtitle: '',
            category: '인사부',
            tags: [],
            reporter: currentUser.name,
            reporterEmail: currentUser.email,
            desk: '인사부',
            status: 'draft',
            urgent: false,
            exclusive: false,
            embargo: null,
            blocks: [],
            lastSaved: '방금 전',
            wordCount: 0,
            charCount: 0,
            aiReviews: [],
            publishDestinations: [],
          }}
          currentUser={currentUser}
          saveStatus={saveStatus}
          lastSavedTime={lastSavedTime}
          activeScreen={activeScreen}
          onOpenVersionHistory={() => {}}
          onOpenPreview={() => {}}
          onOpenPublish={() => {}}
          onNavigate={(screen) => {
            if (screen === 'settings' || screen === 'hr') {
              setActiveScreen(screen);
            }
          }}
          onManualSave={() => {}}
          onLogout={async () => {
            await supabase.auth.signOut();
          }}
        />

        <div className="flex-1 flex overflow-hidden">
          {activeScreen === 'settings' ? (
            <div className="flex-1 overflow-y-auto bg-slate-50 text-slate-800">
              <SettingsView
                currentUser={currentUser}
                onUpdateUser={handleUpdateUserProfile}
              />
            </div>
          ) : (
            <HrDashboard currentUser={currentUser} />
          )}
        </div>
      </div>
    );
  }

  // Newsroom Workspace
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 overflow-hidden font-sans text-slate-100">
      {/* Offline Alert Strip */}
      {!isOnline && (
        <div className="bg-amber-400 text-slate-950 px-4 py-1 text-center text-xs font-bold flex items-center justify-center space-x-1.5 shadow-xs shrink-0 select-none">
          <WifiOff className="w-3.5 h-3.5" />
          <span>오프라인 상태 — 작성 중인 변경사항은 안전하게 유지되며, 재연결 시 자동 저장됩니다.</span>
        </div>
      )}

      {/* 인사부 승인 대기 안내 (승인 전에는 읽기만 가능) */}
      {currentUser.pendingApproval && (
        <div className="bg-amber-400 text-slate-950 px-4 py-1.5 text-center text-xs font-bold flex items-center justify-center space-x-1.5 shadow-xs shrink-0 select-none">
          <Clock className="w-3.5 h-3.5" />
          <span>인사부 승인 대기 중 — 지금은 대시보드와 공유된 기사를 읽기만 할 수 있습니다. 승인되면 프로젝트 만들기 등 모든 기능이 열립니다. (비밀번호 변경은 환경 설정에서 할 수 있어요)</span>
        </div>
      )}

      {/* 1. TOP HEADER */}
      <TopHeader
        article={article || {
          id: '',
          projectId: '',
          projectName: '뉴스룸 대시보드',
          title: '',
          subtitle: '',
          category: currentUser.department || '정치부',
          tags: [],
          reporter: currentUser.name,
          reporterEmail: currentUser.email,
          desk: currentUser.department || '정치부',
          status: 'draft',
          urgent: false,
          exclusive: false,
          embargo: null,
          blocks: [],
          lastSaved: '방금 전',
          wordCount: 0,
          charCount: 0,
          aiReviews: [],
          publishDestinations: [],
        }}
        currentUser={currentUser}
        saveStatus={saveStatus}
        lastSavedTime={lastSavedTime}
        activeScreen={activeScreen}
        isRightPanelOpen={isRightPanelOpen}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        unresolvedFeedbackCount={unresolvedFeedbackCount}
        onOpenVersionHistory={() => setIsHistoryModalOpen(true)}
        onOpenPreview={() => {
          if (article) setActiveScreen('preview');
        }}
        onOpenPublish={handleOpenPublish}
        onNavigate={handleNavigate}
        onManualSave={handleManualSave}
        onLogout={async () => {
          await supabase.auth.signOut();
        }}
        unresolvedAiCount={unresolvedAiCount}
        isManagerReviewMode={isManagerReviewMode}
        onSelectArticle={handleNotificationSelectArticle}
        onSelectProject={handleSelectProject}
        notificationTrigger={notificationTrigger}
      />

      {/* 2. MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <LeftSidebar
          activeScreen={activeScreen}
          onNavigate={handleNavigate}
          onOpenVersionHistory={() => setIsHistoryModalOpen(true)}
          article={article || {
            id: '',
            projectId: '',
            projectName: '',
            title: '',
            subtitle: '',
            category: '',
            tags: [],
            reporter: '',
            reporterEmail: '',
            desk: '',
            status: 'draft',
            urgent: false,
            exclusive: false,
            embargo: null,
            blocks: [],
            lastSaved: '',
            wordCount: 0,
            charCount: 0,
            aiReviews: [],
            publishDestinations: [],
          }}
        />

        {/* Center Content Area */}
        <main className="flex-1 flex overflow-hidden relative">
          {activeScreen === 'dashboard' && (
            <ProjectDashboard
              projects={projects}
              isLoadingProjects={isLoadingProjects}
              onSelectProject={handleSelectProject}
              onCreateProject={handleCreateProject}
              onRenameProject={handleRenameProject}
              onDeleteProject={handleDeleteProject}
              onToggleShareProject={handleToggleShareProject}
              onChangeStatus={handleUpdateProjectStatus}
              onChangeVisibility={handleUpdateProjectVisibility}
              currentUser={currentUser}
            />
          )}

          {activeScreen === 'editor' && (
            isLoadingArticle ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-600">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                <span className="text-sm font-semibold">기사 데이터를 불러오는 중...</span>
              </div>
            ) : article ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {conflictInfo?.detected && (
                  <div className="bg-rose-50 border-b border-rose-300 px-4 py-2 flex items-center justify-between text-xs text-rose-900 select-none shadow-xs shrink-0">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <span className="font-bold">다른 사용자가 이 기사를 수정했습니다.</span>
                        <span className="ml-1 text-rose-700">현재 작성 내용을 덮어쓰지 않도록 자동 저장을 중단했습니다.</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleReloadLatestArticle}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer transition-colors"
                      >
                        최신 내용 다시 불러오기
                      </button>
                      <button
                        onClick={() => setConflictInfo(null)}
                        className="px-2 py-1 bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 rounded font-medium cursor-pointer transition-colors"
                      >
                        현재 내용 유지
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex-1 flex overflow-hidden">
                  <ArticleEditor
                    article={article}
                    onChangeStatus={handleUpdateArticleStatus}
                    onUpdateArticle={handleUpdateArticle}
                    onOpenMediaDrawer={() => {
                      // 미디어 라이브러리는 오른쪽 작업 창의 [미디어] 탭으로 열림 (본문으로 끌어다 놓기 편하도록)
                      setRightPanelTab('media');
                      setIsRightPanelOpen(true);
                      if (article?.projectId) loadProjectMedia(article.projectId);
                    }}
                    onInsertMediaAt={handleInsertMediaAt}
                    saveStatus={saveStatus}
                  lastSavedTime={lastSavedTime}
                  onManualSave={handleManualSave}
                  mediaLibrary={mediaLibrary}
                  isRightPanelOpen={isRightPanelOpen}
                  onOpenFeedback={() => {
                    setRightPanelTab('feedback');
                    setIsRightPanelOpen(true);
                  }}
                  onOpenAuditLogs={() => {
                    setRightPanelTab('audit');
                    setIsRightPanelOpen(true);
                  }}
                  onRunAiScan={handleRunAiScan}
                  unresolvedFeedbackCount={unresolvedFeedbackCount}
                  unresolvedAiCount={unresolvedAiCount}
                  highlightedBlockId={highlightedBlockId}
                  highlightedText={highlightedText}
                  onToggleShare={() => handleToggleShareProject(article.projectId)}
                  onSelectVisibility={(vis) => handleUpdateProjectVisibility(article.projectId, vis)}
                  onSaveBodyDrafts={saveBodyDrafts}
                  onRegisterBodyControls={handleRegisterBodyControls}
                  onBodyEditorActiveChange={handleBodyEditorActiveChange}
                  bodyEditorEpoch={bodyEditorEpoch}
                  onUploadAndInsertMedia={handleUploadAndInsertMedia}
                  isManagerReviewMode={isManagerReviewMode}
                  onImportTxtBlocks={handleImportTxtBlocks}
                  feedbacks={article.feedbacks || []}
                  highlightedFeedbackId={highlightedFeedbackId}
                  onAddFeedback={handleAddFeedback}
                  currentUser={currentUser}
                  onRequestReview={handleRequestReview}
                  onRequestChanges={() => setIsRequestChangesModalOpen(true)}
                  onApproveArticle={() => setIsApproveModalOpen(true)}
                  isDesk={isDesk}
                  isAuthor={isAuthor}
                  isWorkflowLoading={isWorkflowLoading}
                  onToggleAiTools={() => {
                    if (isRightPanelOpen && rightPanelTab !== 'audit') {
                      setIsRightPanelOpen(false);
                    } else {
                      if (rightPanelTab === 'audit') setRightPanelTab('aidraft');
                      setIsRightPanelOpen(true);
                    }
                  }}
                  isAiToolsOpen={isRightPanelOpen && rightPanelTab !== 'audit'}
                />

                {/* Right Panel: AI 도구 (AI 초안 / 인포그래픽 / 피드백 / AI 검수) */}
                {isRightPanelOpen && (() => {
                  const activeTab = isManagerReviewMode && (rightPanelTab === 'aidraft' || rightPanelTab === 'infographic') ? 'feedback' : rightPanelTab;
                  const toolTabs: { key: 'aidraft' | 'infographic' | 'feedback' | 'ai' | 'media'; label: string; Icon: typeof Sparkles; badge?: number; badgeClass?: string }[] = [
                    ...(isManagerReviewMode ? [] : [
                      { key: 'aidraft' as const, label: 'AI 초안', Icon: FileText },
                      { key: 'infographic' as const, label: '인포그래픽', Icon: BarChart3 },
                    ]),
                    { key: 'feedback' as const, label: '피드백', Icon: MessageSquare, badge: unresolvedFeedbackCount, badgeClass: 'bg-amber-500' },
                    { key: 'ai' as const, label: 'AI 검수', Icon: Sparkles, badge: unresolvedAiCount, badgeClass: 'bg-blue-600' },
                    { key: 'media' as const, label: '미디어', Icon: FileText },
                  ];
                  return (
                  <div className="w-96 md:w-[420px] border-l border-slate-200 bg-white flex flex-col h-full shadow-lg z-20 animate-fade-in shrink-0">
                    <div className="flex items-stretch border-b border-slate-200 bg-white select-none shrink-0">
                      <div className="flex-1 flex min-w-0">
                        {toolTabs.map(({ key, label, badge, badgeClass }) => (
                          <button
                            key={key}
                            id={`btn-tab-${key}`}
                            type="button"
                            onClick={() => setRightPanelTab(key)}
                            className={`flex-1 flex items-center justify-center gap-1 px-0.5 py-2.5 text-[11px] border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                              activeTab === key
                                ? 'border-blue-600 text-blue-700 font-bold'
                                : 'border-transparent text-slate-500 hover:text-slate-800 font-semibold'
                            }`}
                          >
                            <span>{label}</span>
                            {!!badge && badge > 0 && (
                              <span className={`px-1.5 rounded-full text-[10px] leading-4 text-white font-bold ${badgeClass}`}>{badge}</span>
                            )}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsRightPanelOpen(false)}
                        className="px-3 text-slate-400 hover:text-slate-700 cursor-pointer border-l border-slate-100"
                        title="창 닫기"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col">
                      {activeTab === 'feedback' ? (
                        <FeedbackPanel
                          feedbacks={article.feedbacks || []}
                          currentUser={currentUser}
                          blocks={article.blocks}
                          onAddFeedback={handleAddFeedback}
                          onAddReply={handleAddReply}
                          onToggleResolve={handleToggleResolveFeedback}
                          onEditFeedback={handleEditFeedback}
                          onDeleteFeedback={handleDeleteFeedback}
                          onToggleFeedbackReaction={handleToggleFeedbackReaction}
                          onToggleReplyReaction={handleToggleReplyReaction}
                          highlightedFeedbackId={highlightedFeedbackId}
                          onFocusFeedback={(feedbackId, blockId) => {
                            setHighlightedFeedbackId(feedbackId);
                            if (blockId) focusArticleBlock(blockId, { highlightBlock: true });
                          }}
                          onFocusBlock={(blockId) => focusArticleBlock(blockId, { highlightBlock: true })}
                        />
                      ) : activeTab === 'ai' ? (
                        <AiReviewPanel
                          reviews={article.aiReviews}
                          selectedReviewId={selectedReviewId}
                          onSelectReview={setSelectedReviewId}
                          onResolveReview={handleResolveReview}
                          onIgnoreReview={handleIgnoreReview}
                          onUndoReview={handleUndoReview}
                          onRunAiScan={handleRunAiScan}
                          isScanning={isAiScanning}
                          cooldownSeconds={scanCooldownSeconds}
                          onFocusBlock={(blockId, highlightText) => focusArticleBlock(blockId, { highlightBlock: true, highlightText })}
                        />
                      ) : activeTab === 'aidraft' ? (
                        <AiInterviewDraftPanel
                          articleId={article.id}
                          currentTitle={article.title}
                          currentUser={currentUser}
                          onApplyBlocks={async (paragraphs) => {
                            if (!article?.id || paragraphs.length === 0) return;
                            await articleBlockService.importTextBlocks(article.id, paragraphs, false);
                            const updated = await articleService.getArticleById(article.id);
                            setArticle(updated);
                            articleRef.current = updated;
                            // AI 출처 기록: AI 초안이 본문에 들어간 사실을 버전 이력에 남김 (출고 창 안내에 사용)
                            try {
                              await articleVersionService.createVersion(
                                article.id,
                                `${AI_DRAFT_VERSION_PREFIX} (AI가 만든 문단 ${paragraphs.length}개 추가)`
                              );
                              await loadArticleVersions(article.id);
                            } catch (verErr) {
                              console.error('[App] AI draft version record failed:', verErr);
                            }
                          }}
                          onApplyTitle={(newTitle) => {
                            handleUpdateArticle({ ...article, title: newTitle });
                          }}
                          compact
                          showToast={showToast}
                        />
                      ) : activeTab === 'audit' ? (
                        <AuditLogPanel articleId={article.id} />
                      ) : null}
                      <div className={activeTab === 'media' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
                        <MediaLibraryView
                          compact
                          currentUser={currentUser}
                          mode="picker"
                          currentProjectId={article?.projectId}
                          canInsert={!!article && !isManagerReviewMode}
                          projects={uploadableProjects}
                          isReadOnly={isManagerReviewMode || isPendingApproval}
                          onInsert={handleLibraryInsert}
                          onDragStartMedia={() => setIsDraggingLibraryMedia(true)}
                          onChanged={() => { if (article?.projectId) loadProjectMedia(article.projectId); }}
                          showToast={showToast}
                          externalFiles={externalUploadFiles}
                          onExternalFilesConsumed={clearExternalUploadFiles}
                        />
                      </div>
                      {!isManagerReviewMode && (
                        <div className={activeTab === 'infographic' ? 'flex-1 min-h-0' : 'hidden'}>
                          <InfographicPanel
                            articleTitle={article.title || ''}
                            paragraphs={article.blocks.filter(b => b.type === 'paragraph' && b.text).map(b => b.text as string)}
                            onInsertImage={async (file) => {
                              await handleUploadAndInsertMedia([file], article.blocks.length);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-600">
                <span className="text-sm font-semibold">선택된 기사가 없습니다. 대시보드에서 프로젝트를 선택해주세요.</span>
              </div>
            )
          )}

          {activeScreen === 'preview' && article && (
            <ArticlePreview
              article={article}
              onBackToEditor={() => setActiveScreen('editor')}
              onOpenPublish={handleOpenPublish}
            />
          )}

          {activeScreen === 'settings' && (
            <div className="flex-1 overflow-y-auto bg-slate-50 text-slate-800">
              <SettingsView
                currentUser={currentUser}
                onUpdateUser={handleUpdateUserProfile}
              />
            </div>
          )}

          {activeScreen === 'guide' && (
            <UserGuideView onNavigate={handleNavigate} />
          )}

          {activeScreen === 'media' && (
            <MediaLibraryView
              currentUser={currentUser}
              mode="page"
              currentProjectId={hasSelectedArticle ? article?.projectId : null}
              canInsert={hasSelectedArticle && !!article && !isManagerReviewMode}
              projects={uploadableProjects}
              isReadOnly={isHrAdmin(currentUser) || isPendingApproval}
              onInsert={handleLibraryInsert}
              onChanged={() => { if (article?.projectId) loadProjectMedia(article.projectId); }}
              showToast={showToast}
            />
          )}
        </main>

      </div>

      {/* Version History Modal */}
      {isHistoryModalOpen && (
        <VersionHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          snapshots={snapshots}
          onRestoreSnapshot={handleRestoreSnapshot}
          onCreateVersion={handleCreateVersion}
          onDeleteSnapshot={isManagerReviewMode ? undefined : handleDeleteSnapshot}
          isLoading={isLoadingVersions}
          isRestoring={isRestoringVersion}
          articleId={article?.id}
        />
      )}

      {/* Publish Modal */}
      {isPublishModalOpen && article && (
        <PublishModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          article={article}
          onConfirmPublish={handleConfirmPublish}
        />
      )}

      {/* Workflow: Request Changes Modal */}
      {isRequestChangesModalOpen && article && (
        <RequestChangesModal
          isOpen={isRequestChangesModalOpen}
          onClose={() => setIsRequestChangesModalOpen(false)}
          onSubmit={handleRequestChanges}
          articleTitle={article.title}
        />
      )}

      {/* Workflow: Approve Confirm Modal */}
      {isApproveModalOpen && article && (
        <ApproveConfirmModal
          isOpen={isApproveModalOpen}
          onClose={() => setIsApproveModalOpen(false)}
          onConfirm={handleApproveArticle}
          articleTitle={article.title}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold flex items-center space-x-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
