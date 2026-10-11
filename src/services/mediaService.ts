/**
 * PRESS-CMS Media Service
 * 
 * 프로젝트별 보도사진/영상 자산 관리(Supabase Storage + public.media) 서비스 레이어입니다.
 * 
 * [핵심 원칙]
 * 1. DB Source of Truth: 영속 storage_path ({project_id}/images/{uuid}.{ext})
 * 2. Runtime: 만료 시간(1시간)을 가진 임시 Signed URL을 동적 발급하여 렌더링에만 사용
 * 3. 기사 블록(article_blocks)에는 만료되는 Signed URL을 절대 저장하지 않고 storage_path를 저장
 * 4. 업로드 실패 시 Storage orphan cleanup 롤백 보장
 * 5. 기사 본문에서 사용 중인 미디어는 삭제 불가 (참조 무결성 보호)
 */

import { friendlyAiError } from './aiErrors';
import { getAiKeyHeaders } from './aiKey';
import { supabase } from '../lib/supabase';
import { ArticleBlock, MediaCategory, MediaItem, MediaArticleUsage } from '../types';
import { DbMediaRow, mapMediaRowToMediaItem } from './mappers';

// 지원 규격 정의
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4'];
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;  // 20MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export const BUCKET_NAME = 'newsroom-media';

/**
 * 암호학적으로 안전한 RFC 4122 UUID v4 생성 함수
 * - crypto.randomUUID 지원 환경: 네이티브 crypto.randomUUID 사용
 * - Insecure Context 등 crypto.randomUUID 미지원 환경: crypto.getRandomValues 기반 RFC 4122 v4 생성
 * - Web Crypto 미지원 환경: 보안 취약 난수(Math.random)를 사용하지 않고 명시적 예외 발생
 */
export function generateCryptographicUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10 (RFC 4122)
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  throw new Error('현재 브라우저 환경에서는 안전한 파일 식별자를 생성할 수 없습니다. 최신 브라우저 또는 HTTPS 환경에서 다시 시도해주세요.');
}

/**
 * 주어진 media_url이 newsroom-media Storage의 영속 reference(storage_path)인지 판별
 */
export function isStorageMediaReference(ref?: string | null): boolean {
  if (!ref) return false;
  // http, https, blob, data URL은 외부/Mock/임시 URL
  if (
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('blob:') ||
    ref.startsWith('data:')
  ) {
    return false;
  }
  // projectUUID/images/fileUUID.ext 또는 projectUUID/videos/fileUUID.ext 형태
  return ref.includes('/') && (ref.includes('/images/') || ref.includes('/videos/'));
}

class MediaService {
  /**
   * 영속 storage_path로부터 1시간 유효한 Signed URL 발급
   */
  async getMediaSignedUrl(storagePath: string, expiresInSeconds: number = 3600): Promise<string> {
    if (!storagePath) return '';
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        console.error(`[MediaService.getMediaSignedUrl] Error for ${storagePath}:`, error);
        return '';
      }

      return data.signedUrl;
    } catch (err) {
      console.error(`[MediaService.getMediaSignedUrl] Exception for ${storagePath}:`, err);
      return '';
    }
  }

  /**
   * 기사 블록의 mediaUrl을 런타임 렌더링용 URL로 변환
   * - storage reference인 경우 Signed URL을 발급
   * - 기존 http/blob URL인 경우 그대로 반환 (하위 호환성 유지)
   */
  async resolveArticleBlockMediaUrl(mediaUrl?: string | null): Promise<string> {
    if (!mediaUrl) return '';
    if (!isStorageMediaReference(mediaUrl)) {
      return mediaUrl;
    }
    return this.getMediaSignedUrl(mediaUrl);
  }

  /**
   * 특정 프로젝트의 모든 미디어 목록 조회 및 Signed URL 일괄 발급
   */
  async getProjectMedia(projectId: string): Promise<MediaItem[]> {
    if (!projectId) return [];

    const { data, error } = await supabase
      .from('media')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[MediaService.getProjectMedia] Error for project ${projectId}:`, error);
      throw new Error(`미디어 목록을 불러오지 못했습니다: ${error.message}`);
    }

    if (!data || data.length === 0) return [];

    // 각 미디어의 Signed URL을 병렬로 생성
    const itemsWithUrls = await Promise.all(
      (data as DbMediaRow[]).map(async (row) => {
        const signedUrl = await this.getMediaSignedUrl(row.storage_path);
        return mapMediaRowToMediaItem(row, signedUrl);
      })
    );

    return itemsWithUrls;
  }

  /**
   * 뉴스룸 전체 미디어 라이브러리 검색 및 목록 조회
   * - RLS에 의해 호출자가 접근 가능한 모든 프로젝트의 미디어만 반환 (권한 준수)
   * - 최근 30~50개 단위 페이징/제한 지원
   */
  async getNewsroomMedia(options?: {
    query?: string;
    mediaType?: 'all' | 'image' | 'video';
    sortOrder?: 'desc' | 'asc';
    limit?: number;
    offset?: number;
  }): Promise<MediaItem[]> {
    let req = supabase
      .from('media')
      .select('*');

    if (options?.mediaType && options.mediaType !== 'all') {
      req = req.eq('media_type', options.mediaType);
    }

    if (options?.query && options.query.trim()) {
      const q = options.query.trim();
      req = req.or(`filename.ilike.%${q}%,original_filename.ilike.%${q}%,caption.ilike.%${q}%,credit.ilike.%${q}%`);
    }

    const ascending = options?.sortOrder === 'asc';
    req = req.order('created_at', { ascending });

    const limit = options?.limit || 40;
    const offset = options?.offset || 0;
    req = req.range(offset, offset + limit - 1);

    const { data, error } = await req;
    if (error) {
      console.error('[MediaService.getNewsroomMedia] Error:', error);
      throw new Error(`미디어 라이브러리 목록을 불러오지 못했습니다: ${error.message}`);
    }

    if (!data || data.length === 0) return [];

    return await Promise.all(
      (data as DbMediaRow[]).map(async (row) => {
        const signedUrl = await this.getMediaSignedUrl(row.storage_path);
        return mapMediaRowToMediaItem(row, signedUrl);
      })
    );
  }

  /**
   * 미디어 전용 탭용 전체 목록 (검색·필터는 화면에서 처리)
   * - RLS에 따라 내가 볼 수 있는 미디어만 반환
   */
  async getLibraryMedia(limit = 300): Promise<MediaItem[]> {
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, limit - 1);

    if (error) {
      console.error('[MediaService.getLibraryMedia] Error:', error);
      throw new Error(`미디어 목록을 불러오지 못했습니다: ${error.message}`);
    }
    if (!data || data.length === 0) return [];

    return await Promise.all(
      (data as DbMediaRow[]).map(async (row) => {
        const signedUrl = await this.getMediaSignedUrl(row.storage_path);
        return mapMediaRowToMediaItem(row, signedUrl);
      })
    );
  }

  /**
   * 부서 목록 (미디어 범위 선택용) - 사용 중인 부서만, 상위/하위 구조 포함
   */
  async getActiveDepartments(): Promise<{ id: string; name: string; parentId: string | null }[]> {
    const { data, error } = await supabase
      .from('departments')
      .select('id, name, parent_id, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data) {
      console.warn('[MediaService.getActiveDepartments] failed:', error);
      return [];
    }
    return data.map((d: any) => ({ id: d.id, name: d.name, parentId: d.parent_id ?? null }));
  }

  /**
   * 특정 미디어가 사용된 기사 목록 조회 (Usage Tracking)
   * - 보안 RPC를 통해 호출자가 접근 가능한 기사 정보만 안전하게 반환
   */
  async getMediaArticleUsages(storagePath: string): Promise<MediaArticleUsage[]> {
    if (!storagePath) return [];
    try {
      const { data, error } = await supabase.rpc('get_media_article_usages', {
        p_storage_path: storagePath,
      });

      if (error) {
        console.error('[MediaService.getMediaArticleUsages] RPC error:', error);
        return [];
      }

      if (!data || !Array.isArray(data)) return [];

      return data.map((row: any) => ({
        articleId: row.article_id,
        articleTitle: row.article_title,
        articleStatus: row.article_status,
        projectId: row.project_id,
        projectName: row.project_name,
      }));
    } catch (err) {
      console.error('[MediaService.getMediaArticleUsages] Exception:', err);
      return [];
    }
  }

  /**
   * 브라우저에서 이미지/영상 해상도 및 재생 시간 추출
   */
  private async extractMediaMetadata(file: File, isVideo: boolean): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
    return new Promise((resolve) => {
      try {
        const objectUrl = URL.createObjectURL(file);

        if (isVideo) {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            const width = video.videoWidth || undefined;
            const height = video.videoHeight || undefined;
            const durationSeconds = video.duration && !isNaN(video.duration) ? Math.round(video.duration) : undefined;
            URL.revokeObjectURL(objectUrl);
            resolve({ width, height, durationSeconds });
          };
          video.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({});
          };
          video.src = objectUrl;
        } else {
          const img = new Image();
          img.onload = () => {
            const width = img.naturalWidth || undefined;
            const height = img.naturalHeight || undefined;
            URL.revokeObjectURL(objectUrl);
            resolve({ width, height });
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({});
          };
          img.src = objectUrl;
        }
      } catch (e) {
        resolve({});
      }
    });
  }

  /**
   * 미디어 파일 업로드 (검증 -> Storage Upload -> DB INSERT -> Signed URL 발급)
   * - DB INSERT 실패 시 Storage 고아 파일 즉시 cleanup 롤백
   */
  async uploadMedia(
    /** 프로젝트에 속하지 않는 사진(사진부 업로드 등)은 null */
    projectId: string | null,
    file: File,
    metadata?: {
      caption?: string;
      credit?: string;
      category?: MediaCategory;
      /** 사진 제목 (비우면 파일 이름) */
      title?: string;
      /** 올린 사람 정보 (이름·이메일·부서) - 없으면 로그인 정보에서 불러옴 */
      uploader?: { name?: string; email?: string; department?: string };
    }
  ): Promise<MediaItem> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('인증되지 않은 사용자입니다. 다시 로그인해주세요.');
    }

    const ext = file.name.split('.').pop()?.toUpperCase() || 'JPG';
    const isVideo = file.type === 'video/mp4' || ext === 'MP4';
    const mediaType = isVideo ? 'video' : 'image';

    // 1. 파일 형식 및 MIME type 검증
    if (isVideo) {
      if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.type) && ext !== 'MP4') {
        throw new Error('지원하지 않는 비디오 형식입니다. MP4 파일만 업로드할 수 있습니다.');
      }
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('비디오 파일 크기는 최대 100MB를 초과할 수 없습니다.');
      }
    } else {
      if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type) && !['JPG', 'JPEG', 'PNG', 'WEBP'].includes(ext)) {
        throw new Error('지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 파일만 업로드할 수 있습니다.');
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('이미지 파일 크기는 최대 20MB를 초과할 수 없습니다.');
      }
    }

    // 2. 메타데이터 (해상도, 영상 길이) 추출
    const dimensions = await this.extractMediaMetadata(file, isVideo);

    // 3. Storage 영속 고유 경로 생성 ({project_id}/{media_type}s/{uuid}.{ext})
    const fileUuid = generateCryptographicUUID();
    const cleanExt = ext.toLowerCase();
    // 프로젝트가 없으면 {내 아이디}/library/ 아래에 보관
    const storagePath = projectId
      ? `${projectId}/${mediaType}s/${fileUuid}.${cleanExt}`
      : `${user.id}/library/${mediaType}s/${fileUuid}.${cleanExt}`;

    // 4. Storage Upload 실행
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file, {
        contentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        upsert: false,
      });

    if (uploadError) {
      console.error('[MediaService.uploadMedia] Storage upload error:', uploadError);
      throw new Error(`파일 스토리지 업로드에 실패했습니다: ${uploadError.message}`);
    }

    // 4-1. 올린 사람 정보 (이름·이메일·부서) 자동 기록
    let uploaderName = metadata?.uploader?.name;
    let uploaderDepartment = metadata?.uploader?.department;
    const uploaderEmail = metadata?.uploader?.email || user.email || undefined;
    if (!uploaderName || !uploaderDepartment) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('name, department')
        .eq('id', user.id)
        .maybeSingle();
      uploaderName = uploaderName || prof?.name || undefined;
      uploaderDepartment = uploaderDepartment || prof?.department || undefined;
    }
    const cleanTitle = (metadata?.title || '').trim();

    // 5. DB INSERT 실행
    const dbPayload: Omit<DbMediaRow, 'id' | 'created_at' | 'updated_at'> = {
      project_id: projectId,
      uploaded_by: user.id,
      storage_path: storagePath,
      filename: `${fileUuid}.${cleanExt}`,
      original_filename: cleanTitle ? `${cleanTitle}.${cleanExt}` : file.name,
      media_type: mediaType,
      file_format: ext === 'JPEG' ? 'JPG' : ext,
      mime_type: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      file_size: file.size,
      width: dimensions.width || null,
      height: dimensions.height || null,
      duration_seconds: dimensions.durationSeconds || null,
      category: metadata?.category || (isVideo ? 'video' : 'press'),
      caption: metadata?.caption || null,
      credit: metadata?.credit || '기자 본인 촬영',
      ai_analysis_status: 'uploaded',
      ai_category: null,
      ai_tags: [],
      ai_caption: null,
      uploader_name: uploaderName || null,
      uploader_email: uploaderEmail || null,
      uploader_department: uploaderDepartment || null,
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from('media')
      .insert(dbPayload)
      .select('*')
      .single();

    // 6. DB INSERT 실패 시 스토리지 고아 파일 즉시 롤백 정리
    if (insertError || !insertedRow) {
      console.error('[MediaService.uploadMedia] DB insert error, rolling back storage file:', insertError);
      await supabase.storage.from(BUCKET_NAME).remove([storagePath]).catch((cleanupErr) => {
        console.error('[MediaService.uploadMedia] Failed to cleanup orphan file:', cleanupErr);
      });
      throw new Error(`미디어 데이터베이스 등록에 실패했습니다: ${insertError?.message || '알 수 없는 오류'}`);
    }

    // 7. 런타임 렌더링용 Signed URL 발급
    const signedUrl = await this.getMediaSignedUrl(storagePath);
    return mapMediaRowToMediaItem(insertedRow as DbMediaRow, signedUrl);
  }

  /**
   * 미디어 캡션, 크레딧, 카테고리 등 메타데이터 수정
   */
  async updateMedia(
    mediaId: string,
    updates: { caption?: string; credit?: string; category?: MediaCategory; title?: string }
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      caption: updates.caption,
      credit: updates.credit,
      category: updates.category,
    };

    // 제목은 원본 파일 이름 칸에 저장 (확장자는 그대로 유지)
    if (updates.title !== undefined) {
      const cleanTitle = updates.title.trim();
      if (cleanTitle) {
        const { data: cur } = await supabase
          .from('media')
          .select('original_filename, file_format')
          .eq('id', mediaId)
          .maybeSingle();
        const m = (cur?.original_filename || '').match(/\.([A-Za-z0-9]+)$/);
        const ext = (m?.[1] || cur?.file_format || 'jpg').toLowerCase();
        payload.original_filename = `${cleanTitle}.${ext}`;
      }
    }

    const { error } = await supabase
      .from('media')
      .update(payload)
      .eq('id', mediaId);

    if (error) {
      console.error(`[MediaService.updateMedia] Error updating media ${mediaId}:`, error);
      throw new Error(`미디어 정보 수정에 실패했습니다: ${error.message}`);
    }
  }

  /**
   * 미디어 삭제 (서버 레벨 사용 여부 검증 RPC -> DB 삭제 -> Storage 정리)
   * - 기사 본문에서 사용 중인 미디어는 서버에서 원천 차단
   */
  async deleteMedia(mediaItem: MediaItem, articleBlocks?: ArticleBlock[]): Promise<void> {
    // 1. 클라이언트 레벨 기사 본문 사용 여부 사전 검증
    if (articleBlocks && articleBlocks.length > 0) {
      const inUse = articleBlocks.some(block => block.mediaUrl === mediaItem.storagePath);
      if (inUse) {
        throw new Error('현재 기사 본문에 사용 중인 미디어는 삭제할 수 없습니다. 기사 본문에서 먼저 해당 미디어를 삭제해주세요.');
      }
    }

    // 2. 서버 레벨 전체 기사 참조 여부 검증 및 DB 레코드 삭제 RPC 실행
    const { data: deletedStoragePath, error: rpcError } = await supabase.rpc('delete_media_asset', {
      p_media_id: mediaItem.id,
    });

    if (rpcError) {
      console.error('[MediaService.deleteMedia] Server protected RPC error:', rpcError);
      throw new Error(rpcError.message || '미디어 삭제에 실패했습니다.');
    }

    // 3. 서버에서 안전하게 DB 삭제 완료 시에만 Storage 물리 파일 정리
    const targetPath = deletedStoragePath || mediaItem.storagePath;
    if (targetPath) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([targetPath]);

      if (storageError) {
        console.warn(`[MediaService.deleteMedia] Storage remove warning for ${targetPath}:`, storageError);
      }
    }
  }

  /**
   * 단일 미디어 조회 (Signed URL 동적 발급 포함)
   */
  async getMediaById(mediaId: string): Promise<MediaItem> {
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .eq('id', mediaId)
      .single();

    if (error || !data) {
      throw new Error(`미디어 조회에 실패했습니다: ${error?.message || ''}`);
    }

    const signedUrl = await this.getMediaSignedUrl(data.storage_path);
    return mapMediaRowToMediaItem(data as DbMediaRow, signedUrl);
  }

  /**
   * 6단계: 이미지 AI 비전 분석 요청 (Edge Function 'analyze-media-image' 호출)
   * - force: true이면 'completed' 상태에서도 명시적 재분석 허용
   */
  async analyzeMediaImage(mediaId: string, force = false): Promise<MediaItem> {
    const { error } = await supabase.functions.invoke('analyze-media-image', {
      body: { mediaId, force },
      headers: await getAiKeyHeaders(),
    });

    if (error) {
      console.error(`[MediaService.analyzeMediaImage] Edge Function error for ${mediaId}:`, error);
      throw new Error(await friendlyAiError(error));
    }

    // 최신 DB row 조회 후 반환 (Signed URL 동적 갱신 포함)
    return await this.getMediaById(mediaId);
  }
}

export const mediaService = new MediaService();

