import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  CheckCheck,
  Inbox,
  AlertCircle,
  Clock,
  CheckCircle2,
  Send,
  RotateCcw,
  ExternalLink,
  Loader2,
  MessageSquare,
  UserPlus,
  UserCog
} from 'lucide-react';
import { AppNotification, NotificationType, NOTIFICATION_TYPE_LABELS } from '../../types';
import { notificationService } from '../../services/notificationService';
import { supabase } from '../../lib/supabase';

interface NotificationCenterProps {
  onSelectArticle?: (articleId: string, projectId?: string) => void;
  // 인사 포털(가입 승인)로 이동
  onOpenHr?: () => void;
  // 외부에서 workflow 트리거 시 갱신을 유도하기 위한 trigger prop (optional)
  refreshTrigger?: number;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  onSelectArticle,
  onOpenHr,
  refreshTrigger,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 알림 데이터 및 미확인 개수 로드
  const loadNotifications = async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const [list, count] = await Promise.all([
        notificationService.getNotifications(30),
        notificationService.getUnreadCount(),
      ]);
      setNotifications(list);
      setUnreadCount(count);
    } catch (err) {
      console.error('[NotificationCenter] Failed to load notifications:', err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  // 초기 로드 및 트리거 변경 시 갱신
  useEffect(() => {
    loadNotifications(false);
  }, [refreshTrigger]);

  // 실시간 수신: 새 알림이 DB에 들어오면 바로 목록을 갱신 (끊기면 60초마다 확인)
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid || cancelled) return;
        channel = supabase
          .channel(`notifications-${uid}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` },
            () => { loadNotifications(false); }
          )
          .subscribe();
      } catch (err) {
        console.error('[NotificationCenter] realtime subscribe failed:', err);
      }
    })();
    const timer = window.setInterval(() => loadNotifications(false), 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // 패널 열릴 때 목록 최신화
  useEffect(() => {
    if (isOpen) {
      loadNotifications(true);
    }
  }, [isOpen]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 단일 알림 클릭 핸들러 (읽음 처리 + 기사 이동)
  const handleNotificationClick = async (notif: AppNotification) => {
    // 1. 읽지 않은 경우 로컬 및 서버 읽음 처리
    if (!notif.isRead) {
      setNotifications(prev =>
        prev.map(n => (n.id === notif.id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      try {
        await notificationService.markAsRead(notif.id);
      } catch (err) {
        console.error('[NotificationCenter] markAsRead error:', err);
      }
    }

    // 2. 패널 닫기
    setIsOpen(false);

    // 3. 기사/프로젝트 Editor로 이동
    if (notif.articleId && onSelectArticle) {
      onSelectArticle(notif.articleId, notif.projectId);
    } else if (notif.type === 'signup_pending') {
      onOpenHr?.();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('press-cms:open-hr-tab', { detail: 'approval' }));
      }, 60);
    }
  };

  // 전체 읽음 처리
  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      await notificationService.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('[NotificationCenter] markAllAsRead error:', err);
    } finally {
      setIsMarkingAll(false);
    }
  };

  // 타입별 아이콘 매핑
  const renderTypeIcon = (type: NotificationType) => {
    switch (type) {
      case 'review_requested':
        return <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
      case 'changes_requested':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
      case 'review_resubmitted':
        return <RotateCcw className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
      case 'article_approved':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
      case 'article_published':
        return <Send className="w-3.5 h-3.5 text-purple-600 shrink-0" />;
      case 'feedback_added':
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
      case 'signup_pending':
        return <UserPlus className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
      case 'profile_changed':
        return <UserCog className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      default:
        return <Bell className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
    }
  };

  // 타입별 배지 스타일 매핑
  const renderTypeBadge = (type: NotificationType) => {
    const meta = NOTIFICATION_TYPE_LABELS[type] || { label: '업무 알림', color: 'slate' };
    const colorClasses: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-700 border-blue-200',
      rose: 'bg-rose-50 text-rose-700 border-rose-200',
      indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
      slate: 'bg-slate-50 text-slate-700 border-slate-200',
    };
    const cls = colorClasses[meta.color] || colorClasses.slate;

    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-flex items-center space-x-1 ${cls}`}>
        {renderTypeIcon(type)}
        <span>{meta.label}</span>
      </span>
    );
  };

  return (
    <div className="relative shrink-0" ref={panelRef}>
      {/* 1. 알림 벨 트리거 버튼 */}
      <button
        id="btn-notification-trigger"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="업무 알림 확인"
        className={`relative p-2 rounded-md transition-colors cursor-pointer flex items-center justify-center ${
          isOpen
            ? 'bg-white/20 text-white'
            : 'text-white/80 hover:text-white hover:bg-white/10'
        }`}
      >
        <Bell className="w-4 h-4" />
        {/* 읽지 않은 알림 카운트 뱃지 (0개면 미표시) */}
        {unreadCount > 0 && (
          <span
            id="badge-unread-notifications"
            className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-500 text-white shadow-xs border-2 border-slate-900 animate-in zoom-in-75 duration-150"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 2. 알림 센터 드롭다운 패널 */}
      {isOpen && (
        <div
          id="panel-notification-center"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-900 animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between select-none">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-900">업무 알림</span>
              {unreadCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700">
                  {unreadCount}건 미확인
                </span>
              ) : (
                <span className="text-[11px] text-slate-400 font-medium">모두 확인됨</span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                id="btn-mark-all-read"
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={isMarkingAll}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center space-x-1 cursor-pointer transition-colors disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>모두 읽음</span>
              </button>
            )}
          </div>

          {/* List Content */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-8 text-center flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
                <span className="text-xs">알림을 불러오는 중입니다...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center text-slate-400">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2.5">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-slate-700">새로운 업무 알림이 없습니다.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">기사 검토, 수정 요청, 승인 내역이 여기에 표시됩니다.</p>
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-3.5 transition-colors cursor-pointer flex items-start space-x-3 group relative ${
                    notif.isRead
                      ? 'bg-white hover:bg-slate-50'
                      : 'bg-blue-50/40 hover:bg-blue-50/70'
                  }`}
                >
                  {/* 안읽음 상태 파란 점 인디케이터 */}
                  {!notif.isRead && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 absolute left-2 top-4 shrink-0" />
                  )}

                  <div className="flex-1 min-w-0 pl-1.5">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      {renderTypeBadge(notif.type)}
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        {notif.createdAtFormatted || '방금 전'}
                      </span>
                    </div>

                    <p className={`text-xs leading-snug line-clamp-2 ${
                      notif.isRead ? 'text-slate-700 font-normal' : 'text-slate-900 font-bold'
                    }`}>
                      {notif.message}
                    </p>

                    {/* 프로젝트 및 바로가기 안내 */}
                    {(notif.projectName || notif.articleTitle) && (
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="truncate max-w-[200px] text-slate-500 font-medium">
                          {notif.projectName || notif.articleTitle}
                        </span>
                        <span className="text-blue-600 group-hover:underline inline-flex items-center space-x-0.5 font-semibold text-[10px]">
                          <span>기사 보기</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-center">
            <span className="text-[10px] text-slate-400">
              알림을 클릭하면 해당 기사 편집기로 바로 이동합니다
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
