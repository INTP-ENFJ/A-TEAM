/**
 * PRESS-CMS Data Mappers
 * 
 * Supabase DB 스키마(snake_case)와 Frontend 모델(camelCase) 간의 양방향 변환을 담당합니다.
 * DB status enum과 사용자 표시 레이블의 매핑을 분리하여 일관성을 보장합니다.
 */

import { 
  Article, 
  ArticleBlock, 
  ArticleStatus, 
  BlockType, 
  Project, 
  ProjectStatus, 
  ProjectVisibility 
} from '../types';

// ==========================================
// 1. DB Row Types (Supabase schema 정의)
// ==========================================

export interface DbProjectRow {
  id: string;
  owner_id: string;
  name: string;
  article_title: string;
  visibility: string;
  shared_at?: string | null;
  shared_by?: string | null;
  coverage_type?: string | null;
  deadline?: string | null;
  created_at: string;
  updated_at: string;
  // 조인 필드 (대표 기사 및 프로필에서 파생)
  owner?: { name?: string; department?: string } | null;
  shared_user?: { name?: string } | null;
  articles?: Array<{ id: string; status: string; title: string }> | null;
}

export interface DbArticleRow {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  subtitle?: string | null;
  category?: string | null;
  tags?: string[] | null;
  status: string;
  urgent: boolean;
  exclusive: boolean;
  embargo?: string | null;
  publish_destinations?: string[] | null;
  deadline_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbArticleBlockRow {
  id: string;
  article_id: string;
  position_index: number;
  type: string;
  text?: string | null;
  media_url?: string | null;
  caption?: string | null;
  credit?: string | null;
  media_type?: string | null;
  file_format?: string | null;
  file_size?: string | null;
  created_at: string;
  updated_at: string;
}

// ==========================================
// 2. Status & Label Mappings
// ==========================================

/**
 * DB status enum -> 프론트엔드 사용자 표시 한글 레이블
 */
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: '초안 작성중',
  review: '데스크 감수',
  changes_requested: '수정 요청됨',
  proofread: '교열/팩트체크',
  ready: '출고 대기',
  published: '출고 완료',
};

/**
 * DB status 문자열을 정규 ArticleStatus 타입으로 안전하게 변환
 */
export function normalizeArticleStatus(statusStr?: string | null): ArticleStatus {
  switch (statusStr) {
    case 'draft':
    case 'Draft':
      return 'draft';
    case 'review':
    case 'Reviewing':
      return 'review';
    case 'changes_requested':
    case 'ChangesRequested':
      return 'changes_requested';
    case 'proofread':
      return 'proofread';
    case 'ready':
    case 'Ready':
      return 'ready';
    case 'published':
      return 'published';
    default:
      return 'draft';
  }
}

/**
 * 날짜 문자열 포맷팅 유틸리티 (YYYY.MM.DD HH:mm)
 */
export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

// ==========================================
// 3. Project Mappers
// ==========================================

export function mapProjectRowToProject(row: DbProjectRow): Project {
  // DB projects 테이블에는 status 컬럼이 없으므로 대표 기사의 articles.status에서 파생
  // 1:N 구조 고려: ready(출고 대기) 상태인 기사가 하나라도 존재하면 최우선 대표 기사로 삼음
  const readyArticle = row.articles?.find(a => normalizeArticleStatus(a.status) === 'ready');
  const representativeArticle = readyArticle || (row.articles && row.articles.length > 0 ? row.articles[0] : null);
  const derivedStatus = normalizeArticleStatus(representativeArticle?.status || 'draft');
  const updatedAtTs = new Date(row.updated_at).getTime() || Date.now();

  return {
    id: row.id,
    ownerId: row.owner_id,
    userId: row.owner_id, // 하위 호환성 유지
    name: row.name,
    articleTitle: row.article_title || representativeArticle?.title || '',
    reporter: row.owner?.name || '기자',
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    updatedAtTimestamp: updatedAtTs,
    status: derivedStatus as ProjectStatus,
    visibility: (row.visibility as ProjectVisibility) || 'private',
    sharedAt: formatDateTime(row.shared_at),
    sharedBy: row.shared_user?.name || undefined,
    desk: row.owner?.department || '정치부',
    coverageType: (row.coverage_type as Project['coverageType']) || '기획취재',
    deadline: row.deadline || undefined,
    charCount: 0,
    pendingReviewsCount: 0,
    aiPendingCount: 0,
    feedbackPendingCount: 0,
  };
}

export function mapProjectToProjectUpdate(project: Partial<Project>): Partial<DbProjectRow> {
  const updates: Partial<DbProjectRow> = {};
  if (project.name !== undefined) updates.name = project.name;
  if (project.articleTitle !== undefined) updates.article_title = project.articleTitle;
  if (project.visibility !== undefined) updates.visibility = project.visibility;
  if (project.sharedAt !== undefined) updates.shared_at = project.sharedAt;
  if (project.coverageType !== undefined) updates.coverage_type = project.coverageType;
  if (project.deadline !== undefined) updates.deadline = project.deadline;
  updates.updated_at = new Date().toISOString();
  return updates;
}

// ==========================================
// 4. Article Block Mappers
// ==========================================

export function mapArticleBlockRowToArticleBlock(row: DbArticleBlockRow): ArticleBlock {
  return {
    id: row.id,
    articleId: row.article_id,
    positionIndex: row.position_index,
    type: (row.type as BlockType) || 'paragraph',
    text: row.text || '',
    mediaUrl: row.media_url || undefined,
    caption: row.caption || undefined,
    credit: row.credit || undefined,
    mediaType: (row.media_type as 'image' | 'video') || undefined,
    fileFormat: row.file_format || undefined,
    fileSize: row.file_size || undefined,
  };
}

export function mapArticleBlockToBlockUpdate(block: Partial<ArticleBlock>): Partial<DbArticleBlockRow> {
  const updates: Partial<DbArticleBlockRow> = {};
  if (block.text !== undefined) updates.text = block.text;
  if (block.mediaUrl !== undefined) updates.media_url = block.mediaUrl;
  if (block.caption !== undefined) updates.caption = block.caption;
  if (block.credit !== undefined) updates.credit = block.credit;
  if (block.mediaType !== undefined) updates.media_type = block.mediaType;
  if (block.fileFormat !== undefined) updates.file_format = block.fileFormat;
  if (block.fileSize !== undefined) updates.file_size = block.fileSize;
  updates.updated_at = new Date().toISOString();
  return updates;
}

// ==========================================
// 5. Article Mappers
// ==========================================

export function mapArticleRowToArticle(
  row: DbArticleRow, 
  blocks: ArticleBlock[] = [], 
  project?: { name: string; reporter?: string; reporterEmail?: string; desk?: string; visibility?: ProjectVisibility }
): Article {
  const normStatus = normalizeArticleStatus(row.status);
  
  // 글자 수 및 단어 수 계산
  const titleLen = (row.title || '').length;
  const subtitleLen = (row.subtitle || '').length;
  const isBodyText = (b: ArticleBlock) => b.type !== 'image' && b.type !== 'video'; // 사진 보이는 위치 기록(text)은 글자로 세지 않음
  const blocksTextLen = blocks.reduce((acc, b) => acc + (isBodyText(b) ? (b.text?.length || 0) : 0), 0);
  const totalCharCount = titleLen + subtitleLen + blocksTextLen;
  const wordCount = blocks.reduce((acc, b) => acc + (isBodyText(b) && b.text ? b.text.trim().split(/\s+/).filter(Boolean).length : 0), 0);

  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    projectName: project?.name || '프로젝트',
    title: row.title || '',
    subtitle: row.subtitle || '',
    category: row.category || '정치',
    tags: Array.isArray(row.tags) ? row.tags : [],
    reporter: project?.reporter || '기자',
    reporterEmail: project?.reporterEmail || '',
    desk: project?.desk || '정치부',
    status: normStatus,
    visibility: project?.visibility || 'private',
    urgent: Boolean(row.urgent),
    exclusive: Boolean(row.exclusive),
    embargo: row.embargo || null,
    blocks: blocks,
    lastSaved: formatDateTime(row.updated_at) || '방금 전',
    wordCount: wordCount,
    charCount: totalCharCount,
    aiReviews: [], // 향후 AI 검수 Supabase 전환 대비 (현재 런타임 mock)
    feedbacks: [], // 향후 Feedback Supabase 전환 대비 (현재 런타임 mock)
    publishDestinations: Array.isArray(row.publish_destinations) && row.publish_destinations.length > 0 
      ? row.publish_destinations 
      : ['포털 뉴스 (네이버/다음)', '뉴스룸 웹사이트'],
    deadlineAt: row.deadline_at || null,
    updatedAt: row.updated_at,
  };
}

/**
 * 일반 기사 메타데이터 수정 매퍼 (status 및 워크플로우/배정 필드는 제외하고 순수 콘텐츠 필드만 매핑)
 */
export function mapArticleToContentOnlyUpdate(article: Partial<Article>): Partial<DbArticleRow> {
  const updates: Partial<DbArticleRow> = {};
  if (article.title !== undefined) updates.title = article.title;
  if (article.subtitle !== undefined) updates.subtitle = article.subtitle;
  if (article.category !== undefined) updates.category = article.category;
  if (article.tags !== undefined) updates.tags = article.tags;
  if (article.urgent !== undefined) updates.urgent = article.urgent;
  if (article.exclusive !== undefined) updates.exclusive = article.exclusive;
  if (article.embargo !== undefined) updates.embargo = article.embargo;
  updates.updated_at = new Date().toISOString();
  return updates;
}

export function mapArticleToArticleUpdate(article: Partial<Article>): Partial<DbArticleRow> {
  const updates: Partial<DbArticleRow> = {};
  if (article.title !== undefined) updates.title = article.title;
  if (article.subtitle !== undefined) updates.subtitle = article.subtitle;
  if (article.category !== undefined) updates.category = article.category;
  if (article.tags !== undefined) updates.tags = article.tags;
  if (article.status !== undefined) updates.status = normalizeArticleStatus(article.status);
  if (article.urgent !== undefined) updates.urgent = article.urgent;
  if (article.exclusive !== undefined) updates.exclusive = article.exclusive;
  if (article.embargo !== undefined) updates.embargo = article.embargo;
  if (article.publishDestinations !== undefined) updates.publish_destinations = article.publishDestinations;
  updates.updated_at = new Date().toISOString();
  return updates;
}

// ==========================================
// 4. Media Mappers
// ==========================================

export interface DbMediaRow {
  id: string;
  project_id: string | null;
  uploaded_by: string;
  storage_path: string;
  filename: string;
  original_filename?: string | null;
  media_type: 'image' | 'video';
  file_format: string;
  mime_type: string;
  file_size: number | string;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  category?: string | null;
  caption?: string | null;
  credit?: string | null;
  ai_analysis_status: string;
  ai_category?: string | null;
  ai_tags?: string[] | null;
  ai_caption?: string | null;
  uploader_name?: string | null;
  uploader_email?: string | null;
  uploader_department?: string | null;
  created_at: string;
  updated_at: string;
}

export function mapMediaRowToMediaItem(row: DbMediaRow, signedUrl?: string): import('../types').MediaItem {
  const bytes = Number(row.file_size) || 0;
  const sizeMB = (bytes / (1024 * 1024)).toFixed(1);
  const sizeStr = bytes >= 1024 * 1024 ? `${sizeMB} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  let resolution = '-';
  if (row.width && row.height) {
    resolution = `${row.width} x ${row.height}`;
  } else if (row.media_type === 'video') {
    resolution = '1920 x 1080 (HD)';
  }

  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    uploadedBy: row.uploaded_by,
    storagePath: row.storage_path,
    title: row.original_filename?.replace(/\.[^/.]+$/, "") || row.filename,
    filename: row.filename,
    originalFilename: row.original_filename || row.filename,
    url: signedUrl || '', // 런타임에 발급된 임시 Signed URL 주입 (DB 저장 금지)
    type: row.media_type,
    format: row.file_format as import('../types').MediaItem['format'],
    mimeType: row.mime_type,
    category: (row.category as any) || (row.media_type === 'video' ? 'video' : 'press'),
    aiCategory: row.ai_category || undefined,
    resolution,
    width: row.width || undefined,
    height: row.height || undefined,
    durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
    fileSize: sizeStr,
    fileSizeBytes: bytes,
    uploadedAt: formatDateTime(row.created_at) || '방금 전',
    createdAt: row.created_at,
    uploaderName: row.uploader_name || undefined,
    uploaderEmail: row.uploader_email || undefined,
    uploaderDepartment: row.uploader_department || undefined,
    caption: row.caption || '',
    credit: row.credit || '기자 본인 촬영',
    aiTags: Array.isArray(row.ai_tags) ? row.ai_tags : [],
    captionSuggestion: row.ai_caption ? `▲ ${row.ai_caption}` : undefined,
    aiCaption: row.ai_caption || undefined,
    aiAnalysisStatus: (row.ai_analysis_status as any) || 'uploaded',
  };
}
