import { supabase } from '../lib/supabase';
import { AuditLogItem, AuditLogAction } from '../types';
import { IAuditLogService } from './apiInterfaces';

// 로컬 시간 포맷팅 헬퍼
function formatAuditTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const timeStr = date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (isToday) {
      return `오늘 ${timeStr}`;
    }

    const dateStr = date.toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
    });
    return `${dateStr} ${timeStr}`;
  } catch {
    return isoString;
  }
}

// 마감일시 포맷팅 헬퍼
function formatDeadlineTime(isoString?: string | null): string {
  if (!isoString) return '없음';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('ko-KR', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

// 업무 액션별 한국어 친화적 상세 설명 생성
function generateDescription(
  action: AuditLogAction,
  metadata: Record<string, any>,
  actorName: string
): string {
  switch (action) {
    case 'ARTICLE_CREATED':
      return `${actorName}님이 기사 초안을 생성했습니다.`;

    case 'REVIEW_REQUESTED':
      return `${actorName}님이 데스크에 기사 검토를 요청했습니다.`;

    case 'CHANGES_REQUESTED':
      return `${actorName}님이 기사 수정을 요청했습니다.`;

    case 'REVIEW_RESUBMITTED':
      return `${actorName}님이 수정한 기사의 재검토를 요청했습니다.`;

    case 'ARTICLE_APPROVED':
      return `${actorName}님이 기사를 최종 승인했습니다 (출고 대기).`;

    case 'ARTICLE_PUBLISHED': {
      const channels = Array.isArray(metadata.channels) ? metadata.channels.join(', ') : '';
      return channels
        ? `${actorName}님이 기사를 최종 출고했습니다. (${channels})`
        : `${actorName}님이 기사를 최종 출고했습니다.`;
    }

    case 'ARTICLE_ASSIGNED': {
      const newAuthor = metadata.new_author_name || '새 담당자';
      return `${actorName}님이 담당 기자를 ${newAuthor} 기자로 배정했습니다.`;
    }

    case 'DEADLINE_CHANGED': {
      const prev = formatDeadlineTime(metadata.previous_deadline);
      const next = formatDeadlineTime(metadata.new_deadline);
      return `${actorName}님이 마감시간을 [${prev}]에서 [${next}]로 변경했습니다.`;
    }

    default:
      return `${actorName}님이 업무를 수행했습니다.`;
  }
}

export class AuditLogService implements IAuditLogService {
  /**
   * 기사별 업무 변경 이력(Audit Log) 목록 조회 (N+1 방지를 위해 actor 프로필 조인)
   */
  async getArticleAuditLogs(articleId: string, limit: number = 50): Promise<AuditLogItem[]> {
    if (!articleId) return [];

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(`
          id,
          actor_id,
          article_id,
          project_id,
          action,
          metadata,
          created_at,
          actor:profiles(id, name, rank, role, department)
        `)
        .eq('article_id', articleId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`[AuditLogService.getArticleAuditLogs] Error fetching logs for article ${articleId}:`, error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => {
        const actorProfile = Array.isArray(row.actor) ? row.actor[0] : row.actor;
        const actorName = actorProfile?.name || '시스템';
        const action = row.action as AuditLogAction;
        const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};

        return {
          id: row.id,
          actorId: row.actor_id,
          actorName: actorName,
          actorRank: actorProfile?.rank,
          actorRole: actorProfile?.role,
          actorDepartment: actorProfile?.department,
          articleId: row.article_id,
          projectId: row.project_id,
          action: action,
          metadata: metadata,
          createdAt: row.created_at,
          createdAtFormatted: formatAuditTime(row.created_at),
          description: generateDescription(action, metadata, actorName),
        };
      });
    } catch (err) {
      console.error(`[AuditLogService.getArticleAuditLogs] Unhandled exception:`, err);
      return [];
    }
  }
}

export const auditLogService = new AuditLogService();
