export type UserRole = 'reporter' | 'desk_editor' | 'editor_in_chief';

export type UserRankCode = 'trainee' | 'reporter' | 'deputy' | 'manager';
export type UserRank = UserRankCode;

export const USER_RANK_LABELS: Record<UserRankCode, string> = {
  trainee: '수습',
  reporter: '평기자',
  deputy: '차장',
  manager: '부장',
};

export const canSubmitArticle = (user: { rank: UserRankCode } | null | undefined): boolean => {
  if (!user) return false;
  return user.rank === 'manager';
};

export interface User {
  id: string;
  name: string;
  role: UserRole;
  rank: UserRankCode;
  roleTitle: string;
  department: string;
  departmentId?: string;
  positionTitleId?: string;
  email: string;
  avatar: string;
  recoveryEmail?: string;
  canManageSignups?: boolean;
  /** 인사부 승인 전 계정: 화면을 읽기만 할 수 있다 (서버가 정한 표식이라 본인이 바꿀 수 없음) */
  pendingApproval?: boolean;
}

export const isHrAdmin = (user: User | null | undefined): boolean => {
  if (!user) return false;
  return user.department === '인사부' && user.canManageSignups === true;
};

export interface EmployeeListItem {
  id: string;
  name: string;
  email: string;
  department: string;
  departmentId?: string | null;
  rank: UserRankCode;
  role: UserRole;
  roleTitle?: string | null;
  positionTitleId?: string | null;
  createdAt: string;
  isActive?: boolean;
}

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PositionTitle {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SignupRequestItem {
  id: string;
  name: string;
  department: string;
  departmentId?: string | null;
  email: string;
  photoUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  assignedRank?: UserRankCode | null;
  assignedRole?: UserRole | null;
  assignedRoleTitle?: string | null;
  assignedPositionTitleId?: string | null;
  authUserId?: string | null;
}

export type ReactionType = 'heart' | 'check' | 'thumbs_up' | 'laugh';

export interface ReactionItem {
  type: ReactionType;
  userIds: string[];
}

export interface FeedbackReply {
  id: string;
  feedbackId?: string;
  authorId?: string;
  authorName: string;
  authorRank: UserRankCode;
  authorRoleTitle?: string;
  createdAt: string;
  content: string;
  reactions?: ReactionItem[];
}

export type FeedbackColor = 'emerald' | 'amber' | 'blue' | 'rose' | 'purple';

export interface ArticleFeedback {
  id: string;
  articleId?: string;
  blockId?: string;
  paragraphIndex?: number;
  authorId?: string;
  authorName: string;
  authorRank: UserRankCode;
  authorRoleTitle?: string;
  createdAt: string;
  updatedAt?: string;
  content: string;
  status?: 'open' | 'resolved';
  isResolved?: boolean;
  selectedText?: string;       // 드래그 선택된 원문 텍스트
  contextBefore?: string;      // 선택 영역 앞 문맥 (위치 복구용)
  contextAfter?: string;       // 선택 영역 뒤 문맥 (위치 복구용)
  startOffset?: number;        // 선택 시작 오프셋
  endOffset?: number;          // 선택 끝 오프셋
  color?: FeedbackColor;       // 피드백별 고유 형광펜 색상
  replies: FeedbackReply[];
  reactions?: ReactionItem[];
}

export type BlockType = 'paragraph' | 'image' | 'video' | 'quote' | 'heading';

export interface ArticleBlock {
  id: string;
  articleId?: string;
  positionIndex?: number;
  type: BlockType;
  text?: string;
  mediaUrl?: string;                  // DB 저장용 영속 Storage Path 또는 기존 URL
  runtimeMediaUrl?: string;           // 브라우저 렌더링용 임시 Signed URL (DB 저장 X)
  caption?: string;
  credit?: string;
  mediaType?: 'image' | 'video';
  fileFormat?: string;
  fileSize?: string;
  highlightedText?: string;
  aiReviewId?: string;
}

// 4개 주요 AI 검수 영역
export type AiReviewCategory = 'spelling' | 'grammar' | 'title_mismatch' | 'style_guide';

// 1) 비문·문장 구조 17개 세부 유형
export type GrammarSubtype = 
  | '주어·서술어 불일치'
  | '목적어·서술어 불일치'
  | '주어 누락'
  | '목적어 누락'
  | '필수 문장성분 누락'
  | '조사 사용 문제'
  | '수식 관계 불명확'
  | '문장 의미 모호'
  | '지나치게 긴 문장'
  | '어순 문제'
  | '접속 관계 문제'
  | '시제 불일치'
  | '피동 표현 문제'
  | '사동 표현 문제'
  | '이중피동'
  | '불필요한 명사화'
  | '표현 중복';

// 2) 제목·본문 비교 6개 세부 유형
export type TitleMismatchSubtype =
  | '제목 내용이 본문에 없음'
  | '제목 인물과 본문 인물 불일치'
  | '기관명 불일치'
  | '숫자/수치 불일치'
  | '제목 표현을 뒷받침할 본문 근거 부족'
  | '본문보다 제목이 지나치게 단정적임';

// 3) 기사 표기법 13개 세부 유형
export type StyleGuideSubtype =
  | '외래어'
  | '영문 표기'
  | '국가명'
  | '지역명'
  | '인명'
  | '기관명'
  | '직책'
  | '숫자'
  | '날짜'
  | '시간'
  | '단위'
  | '약칭'
  | '인용부호';

export type ReviewStatus = 'pending' | 'resolved' | 'ignored';

// 하위 호환성 유지용 타입 별칭
export type AiReviewType = AiReviewCategory | 'information_check' | 'typo';

/**
 * AI 검수 항목 표준 인터페이스
 * - 원문 자동 수정 기능 없이, 기자가 확인하고 참고할 5가지 핵심 정보를 제공
 */
export interface AiReviewItem {
  id: string;
  category?: AiReviewCategory;            // 4대 검수 카테고리
  type?: AiReviewType;                    // 기존 코드 하위 호환성 지원
  subCategory?: string;                   // 세부 문제 유형 (비문, 제목비교, 표기법 등)
  subtype?: string;                       // 레거시 mock 호환
  articleId?: string;
  blockId: string;                        // 연결된 문단 블록 ID (제목인 경우 'title')
  sourceText: string;                     // 1. 문제가 있는 원문
  reason?: string;                        // 2. 문제가 되는 이유
  checkPoint?: string;                    // 3. 기자가 확인할 내용
  suggestionExample?: string;             // 4. 참고용 수정 예시 (자동 적용 불가)
  suggestion?: string;                    // 기존 호환성 유지
  status: ReviewStatus;                   // 'pending' | 'resolved' | 'ignored'
  createdAt: string;
}

// 하위 호환성을 위한 타입 별칭
export type InformationCheckReview = AiReviewItem;
export type TypoReview = AiReviewItem;

export type MediaCategory = 'press' | 'portrait' | 'graphic' | 'on_site' | 'video';
export type AiAssetCategory =
  | '인물'
  | '기자회견'
  | '행사/회의'
  | '현장'
  | '자료'
  | '기타'
  | string;
export type AiAnalysisStatus = 'uploaded' | 'analyzing' | 'completed' | 'failed';

export interface MediaItem {
  id: string;
  projectId?: string;
  uploadedBy?: string;
  storagePath?: string;                     // 영속 Storage 키 (newsroom-media bucket 내 경로)
  title: string;
  filename?: string;
  originalFilename?: string;                // 원본 파일명
  url: string;                              // 런타임 렌더링용 Signed URL 또는 기존 URL
  type: 'image' | 'video';
  format: 'JPG' | 'JPEG' | 'PNG' | 'WEBP' | 'MP4';
  mimeType?: string;
  category: MediaCategory;
  aiCategory?: AiAssetCategory;
  resolution: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  fileSize: string;
  fileSizeBytes?: number;
  uploadedAt: string;
  createdAt?: string;                       // 올린 시각 (정렬/기간 필터용 ISO)
  uploaderName?: string;                    // 올린 기자 이름
  uploaderEmail?: string;                   // 올린 기자 이메일 (사내 화면에서만 표시)
  uploaderDepartment?: string;              // 올린 당시 부서
  caption?: string;                         // 기자가 작성한 캡션
  credit: string;                           // 출처 및 제공자
  aiTags: string[];
  captionSuggestion?: string;
  aiCaption?: string;
  aiAnalysisStatus?: AiAnalysisStatus;
  uploadProgress?: number;
}

export interface MediaArticleUsage {
  articleId: string;
  articleTitle: string;
  articleStatus: string;
  projectId: string;
  projectName: string;
}

export const isDeskUser = (user: User | null | undefined): boolean => {
  if (!user) return false;
  return (
    user.rank === 'manager' ||
    user.rank === 'deputy' ||
    user.role === 'desk_editor' ||
    user.role === 'editor_in_chief'
  );
};

// 부장 이상: 직급이 부장이거나 역할이 편집국장 ("출고 대기 검토"를 볼 수 있는 사람)
export const isManagerOrAboveUser = (user: User | null | undefined): boolean => {
  if (!user) return false;
  return user.rank === 'manager' || user.role === 'editor_in_chief';
};

export type ArticleStatus = 
  | 'draft'              // 초안 작성중
  | 'review'             // 데스크 감수/검토중
  | 'changes_requested'  // 데스크 수정 요청됨
  | 'proofread'          // 교열/팩트체크 (레거시/호환)
  | 'ready'              // 출고 대기 (승인됨)
  | 'published';         // 출고 완료

export type ProjectVisibility = 'private' | 'department' | 'shared';

export interface Article {
  id: string;
  projectId: string;
  authorId?: string;            // Supabase auth.users ID
  projectName: string;
  title: string;
  subtitle: string;
  category: string;
  tags: string[];
  reporter: string;
  reporterEmail: string;
  desk: string;
  status: ArticleStatus;
  visibility?: ProjectVisibility; // 공유 여부 ('private': 내 프로젝트 전용, 'shared': 전체 프로젝트 공유)
  urgent: boolean;
  exclusive: boolean;
  embargo: string | null;
  blocks: ArticleBlock[];
  lastSaved: string;
  wordCount: number;
  charCount: number;
  aiReviews: AiReviewItem[];
  feedbacks?: ArticleFeedback[];
  publishDestinations: string[];
  deadlineAt?: string | null;
  updatedAt?: string;           // DB articles.updated_at ISO 타임스탬프 (동시성 제어용)
}

export type SaveStatus = 'saving' | 'saved' | 'idle' | 'error' | 'offline';

export type ProjectStatus = 'Draft' | 'Reviewing' | 'Ready' | ArticleStatus;

export interface Project {
  id: string;
  ownerId?: string;             // Supabase auth.users ID (projects.owner_id)
  userId?: string;              // 레거시/호환용 ID
  name: string;                 // 프로젝트명
  articleTitle: string;         // 기사 제목
  reporter: string;             // 기자
  createdAt: string;            // 생성일
  updatedAt: string;            // 최종 수정일
  updatedAtTimestamp?: number;  // 정렬용 타임스탬프
  status: ProjectStatus;        // Draft | Reviewing | Ready
  visibility?: ProjectVisibility; // 공유 여부 ('private': 내 프로젝트 전용, 'shared': 전체 프로젝트 공유)
  sharedAt?: string;            // 전체 프로젝트 공유 시각
  sharedBy?: string;            // 공유 실행자 이름
  desk?: string;
  coverageType?: '기획취재' | '일반보도' | '속보' | '심층탐사' | '칼럼';
  deadline?: string;
  charCount?: number;
  pendingReviewsCount?: number;
  aiPendingCount?: number;
  feedbackPendingCount?: number;
}

export interface VersionSnapshot {
  id: string;
  articleId?: string;
  versionNumber?: number;
  title?: string;
  subtitle?: string | null;
  timestamp: string;
  author: string;
  summary: string;
  blocksCount: number;
  wordCount: number;
  snapshotData?: {
    article?: Partial<Article>;
    blocks?: ArticleBlock[];
  };
}

export type AiProvider = 'Google Gemini' | 'OpenAI' | 'Anthropic' | 'Custom API';

export interface AiFunctionModelConfig {
  provider: AiProvider;
  model: string;
}

export interface AiApiSettingsConfig {
  provider: AiProvider;
  apiEndpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  functionModels: {
    informationCheck: AiFunctionModelConfig;
    spellingGrammar: AiFunctionModelConfig;
    imageAnalysis: AiFunctionModelConfig;
    factCheck?: AiFunctionModelConfig;
    missingInfoQuestion?: AiFunctionModelConfig;
  };
}

// 9. 뉴스룸 업무 대시보드(Task Dashboard) 모델
export interface DashboardTaskItem {
  id: string; // articleId
  articleId: string;
  projectId: string;
  projectName: string;
  title: string;
  subtitle?: string;
  status: ArticleStatus;
  authorId: string;
  authorName: string;
  authorEmail?: string;
  authorRank?: UserRankCode;
  department?: string;
  updatedAt: string;
  updatedAtFormatted: string;
  // 수정 요청 정보 (changes_requested 상태인 경우)
  changesReason?: string;
  changesRequestedBy?: string;
  changesRequestedAt?: string;
  // 마감 정보 (deadline_at 기준)
  deadlineAt?: string | null;
  deadlineFormatted?: string;
  isOverdue?: boolean;        // 마감 초과 (deadline < now AND status != 'published')
  isUrgentDeadline?: boolean; // 마감 임박 (24시간 이내)
}

export interface DashboardSummary {
  // 기자 개인 통계
  myDraftCount: number;
  myChangesRequestedCount: number;
  myInReviewCount: number;
  myReadyCount: number;
  myPublishedCount: number;
  // 데스크 검토 통계 (데스크용)
  deskReviewQueueCount: number;
  deskChangesRequestedCount: number;
  deskReadyQueueCount: number;
  // 마감 관리 통계
  urgentDeadlineCount?: number;
  overdueCount?: number;
}

// 10. 인앱 업무 알림(Notification Center) 모델
export type NotificationType = 
  | 'review_requested'     // 검토 요청
  | 'changes_requested'    // 수정 요청
  | 'review_resubmitted'   // 재검토 요청
  | 'article_approved'     // 승인 완료
  | 'article_published'    // 출고 완료
  | 'article_assigned'     // 기사 배정
  | 'deadline_changed'    // 마감시간 변경
  | 'feedback_added'      // 새 피드백
  | 'signup_pending'      // 가입 승인 요청 (인사 담당자용)
  | 'profile_changed';    // 내 인사 정보 변경

export interface AppNotification {
  id: string;
  recipientId: string;
  actorId?: string;
  actorName?: string;
  articleId: string;
  projectId?: string;
  projectName?: string;
  articleTitle?: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  createdAtFormatted?: string;
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, { label: string; color: string }> = {
  review_requested: { label: '검토 요청', color: 'blue' },
  changes_requested: { label: '수정 요청', color: 'rose' },
  review_resubmitted: { label: '재검토 요청', color: 'indigo' },
  article_approved: { label: '승인 완료', color: 'emerald' },
  article_published: { label: '출고 완료', color: 'purple' },
  article_assigned: { label: '기사 배정', color: 'indigo' },
  deadline_changed: { label: '마감 변경', color: 'amber' },
  feedback_added: { label: '새 피드백', color: 'emerald' },
  signup_pending: { label: '가입 승인', color: 'blue' },
  profile_changed: { label: '인사 변경', color: 'amber' },
};

// 10-1. 부서 기자 모델 (기사 배정용)
export interface DepartmentReporter {
  id: string;
  name: string;
  rank: string;
  role: string;
  department: string;
}

// 11. 통합 검색(Global Search) 모델
export interface SearchResultArticle {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  subtitle?: string;
  category?: string;
  tags?: string[];
  status: ArticleStatus;
  authorName?: string;
  authorDepartment?: string;
  updatedAt: string;
  updatedAtFormatted?: string;
}

export interface SearchResultProject {
  id: string;
  name: string;
  articleTitle?: string;
  visibility: ProjectVisibility;
  ownerName?: string;
  ownerDepartment?: string;
  updatedAt: string;
  updatedAtFormatted?: string;
}

export interface GlobalSearchResult {
  articles: SearchResultArticle[];
  projects: SearchResultProject[];
  totalCount: number;
}

// 12. Audit Log (업무 변경 이력) 모델
export type AuditLogAction = 
  | 'ARTICLE_CREATED'
  | 'REVIEW_REQUESTED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_RESUBMITTED'
  | 'ARTICLE_APPROVED'
  | 'ARTICLE_PUBLISHED'
  | 'ARTICLE_ASSIGNED'
  | 'DEADLINE_CHANGED'
  | 'VERSION_DELETED';

export interface AuditLogItem {
  id: string;
  actorId?: string | null;
  actorName?: string;
  actorRank?: string;
  actorRole?: string;
  actorDepartment?: string;
  articleId: string;
  projectId?: string | null;
  action: AuditLogAction;
  metadata: Record<string, any>;
  createdAt: string;
  createdAtFormatted?: string;
  description?: string;
}

export const AUDIT_LOG_ACTION_LABELS: Record<AuditLogAction, { label: string; color: string; badgeColor: string }> = {
  ARTICLE_CREATED: { label: '기사 생성', color: 'slate', badgeColor: 'bg-slate-100 text-slate-700 border-slate-300' },
  REVIEW_REQUESTED: { label: '검토 요청', color: 'blue', badgeColor: 'bg-blue-100 text-blue-800 border-blue-300' },
  CHANGES_REQUESTED: { label: '수정 요청', color: 'rose', badgeColor: 'bg-rose-100 text-rose-800 border-rose-300' },
  REVIEW_RESUBMITTED: { label: '재검토 요청', color: 'indigo', badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  ARTICLE_APPROVED: { label: '승인 완료', color: 'emerald', badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ARTICLE_PUBLISHED: { label: '출고 완료', color: 'purple', badgeColor: 'bg-purple-100 text-purple-800 border-purple-300' },
  ARTICLE_ASSIGNED: { label: '기자 배정', color: 'sky', badgeColor: 'bg-sky-100 text-sky-800 border-sky-300' },
  DEADLINE_CHANGED: { label: '마감 변경', color: 'amber', badgeColor: 'bg-amber-100 text-amber-800 border-amber-300' },
  VERSION_DELETED: { label: '이력 삭제', color: 'slate', badgeColor: 'bg-slate-100 text-slate-700 border-slate-300' },
};

// 13. Publish Preflight (출고 전 최종 검증) 모델
export interface PublishPreflightIssue {
  code: string;
  message: string;
}

export interface PublishPreflightChecks {
  status_ready: boolean;
  title_valid: boolean;
  body_valid: boolean;
  channels_valid: boolean;
  embargo_valid: boolean;
  permission_valid?: boolean;
}

export interface PublishPreflightResult {
  valid: boolean;
  article_id?: string;
  checks: PublishPreflightChecks;
  issues: PublishPreflightIssue[];
}

// 14. 동시 편집 충돌 모델
export interface ConflictInfo {
  detected: boolean;
  serverUpdatedAt?: string;
  serverTitle?: string;
}

// 15. 비밀번호 분실 신고 모델
export interface PasswordResetRequest {
  id: string;
  name: string;
  loginId: string;
  companyEmail: string;
  recoveryEmail?: string | null;
  registeredRecoveryEmail?: string | null;
  department?: string | null;
  status: 'pending' | 'resolved';
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  adminNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}


