/**
 * PRESS-CMS Article Version Service
 * 
 * 기사 버전 히스토리(article_versions) 관리 및 스냅샷 생성/복원(Restore) 서비스입니다.
 * Supabase RPC를 통해 원자적으로 버전 생성 및 안전한 복원(복원 직전 자동 백업 포함)을 수행합니다.
 */

import { supabase } from '../lib/supabase';
import { VersionSnapshot } from '../types';
import { IArticleVersionService } from './apiInterfaces';

// 시간 포맷 헬퍼 (HH:mm 또는 YYYY-MM-DD HH:mm)
function formatTimestamp(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timePart = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (isToday) {
      return timePart;
    }
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}월 ${day}일 ${timePart}`;
  } catch {
    return isoStr;
  }
}

class ArticleVersionService implements IArticleVersionService {
  /**
   * 특정 기사의 버전 목록 조회 (version_number DESC 순서)
   */
  async getVersions(articleId: string): Promise<VersionSnapshot[]> {
    if (!articleId) return [];

    const { data, error } = await supabase.rpc('get_article_versions', {
      p_article_id: articleId,
    });

    if (error) {
      console.error(`[ArticleVersionService.getVersions] RPC error for article ${articleId}:`, error);
      throw new Error(`버전 이력을 불러오지 못했습니다: ${error.message}`);
    }

    if (!data) return [];

    return (data as Array<{
      id: string;
      article_id: string;
      version_number: number;
      title: string;
      subtitle: string | null;
      blocks_count: number;
      char_count: number;
      summary: string;
      created_by: string;
      author_name: string;
      created_at: string;
    }>).map(row => ({
      id: row.id,
      articleId: row.article_id,
      versionNumber: row.version_number,
      title: row.title,
      subtitle: row.subtitle,
      timestamp: formatTimestamp(row.created_at),
      author: row.author_name || '기자',
      summary: row.summary || `v${row.version_number} 버전`,
      blocksCount: row.blocks_count || 0,
      wordCount: row.char_count || 0,
    }));
  }

  /**
   * 특정 버전의 상세 스냅샷(본문 블록 포함) 조회 (미리보기 용도)
   */
  async getVersionDetail(versionId: string): Promise<VersionSnapshot> {
    if (!versionId) throw new Error('조회할 버전 ID가 유효하지 않습니다.');

    const { data, error } = await supabase
      .from('article_versions')
      .select('*, author:profiles!created_by(name)')
      .eq('id', versionId)
      .single();

    if (error || !data) {
      console.error(`[ArticleVersionService.getVersionDetail] Query error for version ${versionId}:`, error);
      throw new Error(`버전 상세 정보를 불러오지 못했습니다: ${error?.message || ''}`);
    }

    const row = data as {
      id: string;
      article_id: string;
      version_number: number;
      title: string;
      subtitle: string | null;
      blocks_count: number;
      char_count: number;
      summary: string;
      snapshot_data: any;
      created_at: string;
      author?: { name?: string } | null;
    };

    return {
      id: row.id,
      articleId: row.article_id,
      versionNumber: row.version_number,
      title: row.title,
      subtitle: row.subtitle,
      timestamp: formatTimestamp(row.created_at),
      author: row.author?.name || '기자',
      summary: row.summary,
      blocksCount: row.blocks_count,
      wordCount: row.char_count,
      snapshotData: row.snapshot_data,
    };
  }

  /**
   * 현재 기사 상태를 새 버전으로 원자적 저장 (create_article_version RPC)
   */
  async createVersion(articleId: string, summary: string = '수동 버전 저장'): Promise<VersionSnapshot> {
    if (!articleId) throw new Error('기사 ID가 유효하지 않습니다.');

    const { data, error } = await supabase.rpc('create_article_version', {
      p_article_id: articleId,
      p_summary: summary.trim() || '수동 버전 저장',
    });

    if (error) {
      console.error(`[ArticleVersionService.createVersion] RPC error for article ${articleId}:`, error);
      throw new Error(`새 버전 생성에 실패했습니다: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('생성된 버전 정보가 반환되지 않았습니다.');
    }

    const created = data[0];
    return {
      id: created.id,
      articleId: created.article_id,
      versionNumber: created.version_number,
      title: created.title,
      subtitle: created.subtitle,
      timestamp: formatTimestamp(created.created_at),
      author: created.author_name || '기자',
      summary: created.summary,
      blocksCount: created.blocks_count || 0,
      wordCount: created.char_count || 0,
    };
  }

  /**
   * 특정 버전으로 기사 원자적 복원 (restore_article_version RPC)
   * - 복원 직전 현재 상태를 자동으로 신규 백업 저장
   * - 스냅샷 데이터를 articles 및 article_blocks 테이블에 일괄 복원
   * - 복원 완료에 대한 신규 버전 추가 기록
   */
  async restoreVersion(versionId: string): Promise<{ success: boolean; articleId: string; restoredVersionNumber: number }> {
    if (!versionId) throw new Error('복원할 버전 ID가 유효하지 않습니다.');

    const { data, error } = await supabase.rpc('restore_article_version', {
      p_version_id: versionId,
    });

    if (error) {
      console.error(`[ArticleVersionService.restoreVersion] RPC error for version ${versionId}:`, error);
      throw new Error(`버전 복원에 실패했습니다: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('복원 결과가 반환되지 않았습니다.');
    }

    const result = data[0];
    return {
      success: result.success,
      articleId: result.article_id,
      restoredVersionNumber: result.restored_version_number,
    };
  }
}

export const articleVersionService = new ArticleVersionService();
