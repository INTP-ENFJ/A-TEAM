import { supabase } from '../lib/supabase';
import { AppNotification, NotificationType } from '../types';
import { INotificationService } from './apiInterfaces';

/**
 * 상대 시간 변환 헬퍼 (예: '방금 전', '5분 전', '2시간 전', '어제', 'YYYY.MM.DD')
 */
export function formatTimeAgo(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return '방금 전';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * PRESS-CMS 인앱 업무 알림(Notification Center) 전담 Service Layer
 * N+1 쿼리를 방지하며, RLS 정책을 준수하여 허용된 본인 알림만 안전하게 조회/처리합니다.
 */
class NotificationService implements INotificationService {
  /**
   * 본인의 최신 알림 목록을 조회합니다.
   * Supabase Foreign Key Join을 통해 actor(행동 실행자)와 article/project 정보를 단일 쿼리로 매핑합니다.
   */
  async getNotifications(limit: number = 30): Promise<AppNotification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id,
        recipient_id,
        actor_id,
        article_id,
        type,
        title,
        message,
        is_read,
        created_at,
        actor:profiles!notifications_actor_id_fkey(id, name),
        article:articles!notifications_article_id_fkey(
          id, 
          title, 
          project_id,
          project:projects!articles_project_id_fkey(id, name)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[NotificationService.getNotifications] Error:', error);
      throw new Error(`알림 목록을 불러오지 못했습니다: ${error.message}`);
    }

    if (!data) return [];

    return data.map((item: any): AppNotification => {
      const actorData = Array.isArray(item.actor) ? item.actor[0] : item.actor;
      const articleData = Array.isArray(item.article) ? item.article[0] : item.article;
      const projectData = articleData?.project 
        ? (Array.isArray(articleData.project) ? articleData.project[0] : articleData.project)
        : null;

      return {
        id: item.id,
        recipientId: item.recipient_id,
        actorId: item.actor_id || undefined,
        actorName: actorData?.name || undefined,
        articleId: item.article_id,
        projectId: articleData?.project_id || undefined,
        projectName: projectData?.name || undefined,
        articleTitle: articleData?.title || undefined,
        type: item.type as NotificationType,
        title: item.title,
        message: item.message,
        isRead: Boolean(item.is_read),
        createdAt: item.created_at,
        createdAtFormatted: formatTimeAgo(item.created_at),
      };
    });
  }

  /**
   * 읽지 않은 알림 개수를 조회합니다 (빠른 Head 카운트 쿼리)
   */
  async getUnreadCount(): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) {
      console.error('[NotificationService.getUnreadCount] Error:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * 단일 알림을 읽음 처리합니다 (RPC 호출 후 fallback update)
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('mark_notification_as_read', {
        p_notification_id: notificationId,
      });

      if (!error) return Boolean(data);
    } catch {
      // RPC fallback to direct update
    }

    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (updateError) {
      console.error('[NotificationService.markAsRead] Error:', updateError);
      return false;
    }

    return true;
  }

  /**
   * 모든 읽지 않은 알림을 일괄 읽음 처리합니다
   */
  async markAllAsRead(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('mark_all_notifications_as_read');
      if (!error && typeof data === 'number') return data;
    } catch {
      // RPC fallback to direct update
    }

    const { data: updated, error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false)
      .select('id');

    if (updateError) {
      console.error('[NotificationService.markAllAsRead] Error:', updateError);
      return 0;
    }

    return updated ? updated.length : 0;
  }
}

export const notificationService = new NotificationService();
