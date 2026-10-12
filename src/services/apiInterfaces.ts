/**
 * PRESS-CMS Supabase Backend Service Layer Interfaces
 * 
 * Supabase를 단일 진실 공급원(Single Source of Truth)으로 사용하는
 * Service Layer의 공통 인터페이스 및 에러/결과 규격입니다.
 */

import { 
  Article, 
  ArticleBlock, 
  ArticleFeedback, 
  AiReviewItem, 
  FeedbackReply, 
  MediaItem, 
  Project, 
  ProjectVisibility,
  VersionSnapshot,
  User,
  DashboardTaskItem,
  DashboardSummary,
  AppNotification,
  GlobalSearchResult,
  DepartmentReporter,
  AuditLogItem,
  MediaArticleUsage,
  MediaCategory,
  PublishPreflightResult
} from '../types';

// 공통 서비스 에러 인터페이스
export interface ServiceError {
  code: string;
  message: string;
  details?: unknown;
}

// 공통 비동기 결과 타입
export type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: ServiceError };

// 1. Project Service
export interface CreateProjectParams {
  name: string;
  articleTitle: string;
  category?: string;
  coverageType?: string;
  deadline?: string;
}

export interface IProjectService {
  /** 현재 로그인 사용자가 RLS 기준으로 접근 가능한 프로젝트 목록 조회 */
  getProjects(): Promise<Project[]>;
  /** 특정 프로젝트 단건 조회 */
  getProjectById(projectId: string): Promise<Project>;
  /** RPC(create_project_with_initial_article)를 통한 프로젝트 및 초기 기사 생성 */
  createProject(params: CreateProjectParams): Promise<{ projectId: string; articleId: string; initialBlockId: string }>;
  /** 프로젝트 메타데이터 업데이트 */
  updateProject(projectId: string, updates: Partial<Project>): Promise<Project>;
  /** 프로젝트 삭제 (관련 기사/블록 cascade 확인) */
  deleteProject(projectId: string): Promise<void>;
  /** 프로젝트 전체 공유 여부 토글 */
  toggleShareProject(projectId: string, nextVisibility: ProjectVisibility): Promise<Project>;
}

// 2. Article Service
export interface IArticleService {
  /** 프로젝트 ID로 대표 기사 조회 (하위 블록 포함) */
  getArticleByProjectId(projectId: string): Promise<Article>;
  /** 기사 ID로 단건 조회 */
  getArticleById(articleId: string): Promise<Article>;
  /** 기사 메타데이터/상태 저장 (옵션: 동시성 검증 및 콘텐츠 전용 필터링) */
  updateArticle(
    articleId: string, 
    updates: Partial<Article>, 
    options?: { expectedUpdatedAt?: string; contentOnly?: boolean }
  ): Promise<Article>;
  /** 전용 보안 RPC(publish_article)를 통한 안전한 최종 출고 */
  publishArticle(articleId: string, channels: string[]): Promise<{ success: boolean; publishedAt: string }>;
  /** 전용 RPC(validate_article_for_publish)를 통한 출고 전 사전 종합 검증 */
  validatePublishPreflight(articleId: string, channels?: string[]): Promise<PublishPreflightResult>;
}

// 3. Article Block Service
export interface IArticleBlockService {
  /** 기사에 속한 전체 블록 조회 (position_index ASC 정렬) */
  getBlocksByArticleId(articleId: string): Promise<ArticleBlock[]>;
  /** 새 본문 문단(paragraph) 블록 생성 */
  createBlock(articleId: string, block: Partial<ArticleBlock>, positionIndex: number): Promise<ArticleBlock>;
  /** 임의 위치에 미디어 블록 원자적 삽입 (position_index 충돌 방지 RPC 사용) */
  insertMediaBlockAt?(articleId: string, block: Partial<ArticleBlock>, targetIndex: number): Promise<ArticleBlock>;
  /** 여러 블록 일괄 생성 (대량 Paste 등 원자적 배치 삽입용) */
  createBlocksBatch(articleId: string, blocks: Array<{ type?: 'paragraph' | 'image' | 'video' | 'quote'; text?: string; positionIndex: number }>): Promise<ArticleBlock[]>;
  /** 특정 블록 내용/속성 수정 */
  updateBlock(blockId: string, updates: Partial<ArticleBlock>): Promise<ArticleBlock>;
  /** 블록 삭제 */
  deleteBlock(blockId: string): Promise<void>;
  /** RPC(reorder_article_blocks)를 통한 블록 원자적 재정렬 */
  reorderBlocks(articleId: string, blockIds: string[]): Promise<void>;
  /** RPC(import_article_blocks)를 통한 TXT 문단 일괄 삽입 */
  importTextBlocks(articleId: string, paragraphs: string[], replaceExisting?: boolean): Promise<string[]>;
}

// 4. AI Review Service (Mock 유지용)
export interface IAiReviewService {
  getReviewsByArticleId(articleId: string): Promise<AiReviewItem[]>;
  runAiScan(articleId: string): Promise<AiReviewItem[]>;
  resolveReview(reviewId: string): Promise<void>;
  ignoreReview(reviewId: string): Promise<void>;
  undoReview(reviewId: string): Promise<void>;
}

// 5. Feedback Service (Mock 유지용)
export interface IFeedbackService {
  getFeedbacksByArticleId(articleId: string): Promise<ArticleFeedback[]>;
  createFeedback(articleId: string, feedback: Omit<ArticleFeedback, 'id' | 'createdAt' | 'replies'>): Promise<ArticleFeedback>;
  createReply(feedbackId: string, reply: Omit<FeedbackReply, 'id' | 'createdAt'>): Promise<FeedbackReply>;
  toggleResolveFeedback(feedbackId: string): Promise<{ isResolved: boolean }>;
}

// 6. Media Service (보도사진/영상 자산 관리)
export interface IMediaService {
  getProjectMedia(projectId: string): Promise<MediaItem[]>;
  getNewsroomMedia(options?: {
    query?: string;
    mediaType?: 'all' | 'image' | 'video';
    sortOrder?: 'desc' | 'asc';
    limit?: number;
    offset?: number;
  }): Promise<MediaItem[]>;
  getMediaArticleUsages(storagePath: string): Promise<MediaArticleUsage[]>;
  uploadMedia(
    projectId: string,
    file: File,
    metadata?: { caption?: string; credit?: string; category?: MediaCategory }
  ): Promise<MediaItem>;
  updateMedia(
    mediaId: string,
    updates: { caption?: string; credit?: string; category?: MediaCategory }
  ): Promise<void>;
  deleteMedia(mediaItem: MediaItem, articleBlocks?: ArticleBlock[]): Promise<void>;
  analyzeMediaImage(mediaId: string, force?: boolean): Promise<MediaItem>;
}

// 7. Version History Service (Supabase 영속화)
export interface IArticleVersionService {
  getVersions(articleId: string): Promise<VersionSnapshot[]>;
  getVersionDetail(versionId: string): Promise<VersionSnapshot>;
  createVersion(articleId: string, summary?: string): Promise<VersionSnapshot>;
  restoreVersion(versionId: string): Promise<{ success: boolean; articleId: string; restoredVersionNumber: number }>;
  deleteVersion(versionId: string): Promise<void>;
}

export type IVersionService = IArticleVersionService;

// 8. Article Workflow Service (기사 검토·승인 워크플로우 & 배정)
export interface IArticleWorkflowService {
  requestReview(articleId: string): Promise<Article>;
  requestChanges(articleId: string, reason: string): Promise<Article>;
  approveArticle(articleId: string): Promise<Article>;
  assignArticle(articleId: string, authorId: string, deadlineAt: string | null): Promise<Article>;
  getDepartmentReporters(): Promise<DepartmentReporter[]>;
}

// 9. Dashboard Service (뉴스룸 업무 대시보드)
export interface IDashboardService {
  getDashboardTasks(currentUser: User): Promise<{
    tasks: DashboardTaskItem[];
    summary: DashboardSummary;
  }>;
}

// 10. Notification Service (인앱 업무 알림)
export interface INotificationService {
  getNotifications(limit?: number): Promise<AppNotification[]>;
  getUnreadCount(): Promise<number>;
  markAsRead(notificationId: string): Promise<boolean>;
  markAllAsRead(): Promise<number>;
}

// 11. Global Search Service (통합 검색)
export interface ISearchService {
  search(query: string): Promise<GlobalSearchResult>;
}

// 12. Audit Log Service (업무 변경 이력)
export interface IAuditLogService {
  getArticleAuditLogs(articleId: string, limit?: number): Promise<AuditLogItem[]>;
}
