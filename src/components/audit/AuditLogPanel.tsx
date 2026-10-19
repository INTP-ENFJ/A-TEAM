import React, { useState, useEffect, useCallback } from 'react';
import { 
  History, 
  RotateCw, 
  FileEdit, 
  Send, 
  AlertCircle, 
  CheckCircle2, 
  Globe, 
  UserCheck, 
  Calendar,
  Loader2
} from 'lucide-react';
import { AuditLogItem, AuditLogAction, AUDIT_LOG_ACTION_LABELS } from '../../types';
import { auditLogService } from '../../services/auditLogService';

interface AuditLogPanelProps {
  articleId: string;
}

// 액션별 아이콘 매핑
function getActionIcon(action: AuditLogAction) {
  switch (action) {
    case 'ARTICLE_CREATED':
      return <FileEdit className="w-3.5 h-3.5 text-slate-600" />;
    case 'REVIEW_REQUESTED':
      return <Send className="w-3.5 h-3.5 text-blue-600" />;
    case 'CHANGES_REQUESTED':
      return <AlertCircle className="w-3.5 h-3.5 text-rose-600" />;
    case 'REVIEW_RESUBMITTED':
      return <RotateCw className="w-3.5 h-3.5 text-indigo-600" />;
    case 'ARTICLE_APPROVED':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
    case 'ARTICLE_PUBLISHED':
      return <Globe className="w-3.5 h-3.5 text-purple-600" />;
    case 'ARTICLE_ASSIGNED':
      return <UserCheck className="w-3.5 h-3.5 text-sky-600" />;
    case 'DEADLINE_CHANGED':
      return <Calendar className="w-3.5 h-3.5 text-amber-600" />;
    default:
      return <History className="w-3.5 h-3.5 text-slate-500" />;
  }
}

export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({ articleId }) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!articleId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await auditLogService.getArticleAuditLogs(articleId, 50);
      setLogs(data);
    } catch (err: any) {
      console.error('[AuditLogPanel] loadLogs error:', err);
      setError('업무 이력을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="flex flex-col h-full bg-slate-50/50 text-xs">
      {/* 헤더 및 새로고침 */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200">
        <div className="flex items-center space-x-1.5 font-bold text-slate-700">
          <History className="w-4 h-4 text-slate-500" />
          <span>기사 업무 이력 ({logs.length}건)</span>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          disabled={isLoading}
          className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors disabled:opacity-50 cursor-pointer"
          title="새로고침"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 목록 컨텐츠 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isLoading && logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
            <span>업무 이력을 조회하는 중...</span>
          </div>
        ) : error ? (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-center">
            <History className="w-8 h-8 text-slate-300 mb-2" />
            <p className="font-semibold text-slate-600">기록된 업무 이력이 없습니다.</p>
            <p className="text-[12px] text-slate-400 mt-1">
              검토 요청, 수정 요청, 승인, 출고, 배정 등의 작업이 발생하면 여기에 기록됩니다.
            </p>
          </div>
        ) : (
          <div className="relative border-l-2 border-slate-200 ml-2.5 space-y-3 pl-3 py-1">
            {logs.map((log) => {
              const labelInfo = AUDIT_LOG_ACTION_LABELS[log.action] || {
                label: log.action,
                badgeColor: 'bg-slate-100 text-slate-700 border-slate-300',
              };

              return (
                <div
                  key={log.id}
                  className="relative group bg-white p-3 rounded-lg border border-slate-200 shadow-2xs hover:border-slate-300 transition-all"
                >
                  {/* 타임라인 노드 아이콘 */}
                  <div className="absolute -left-[19px] top-3.5 w-4 h-4 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center group-hover:border-blue-500 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 group-hover:bg-blue-500" />
                  </div>

                  {/* 상단: 액션 뱃지 + 발생 시각 */}
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center space-x-1.5">
                      <span className="shrink-0">{getActionIcon(log.action)}</span>
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[12px] font-bold border ${labelInfo.badgeColor}`}
                      >
                        {labelInfo.label}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-400 whitespace-nowrap">
                      {log.createdAtFormatted}
                    </span>
                  </div>

                  {/* 본문: 한국어 친화적 설명 */}
                  <p className="text-slate-800 font-medium leading-relaxed mb-1">
                    {log.description}
                  </p>

                  {/* 하단: 행위자 메타 정보 */}
                  <div className="flex items-center space-x-2 text-[12px] text-slate-500 pt-1 border-t border-slate-100">
                    <span className="font-semibold text-slate-700">{log.actorName}</span>
                    {log.actorDepartment && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span>{log.actorDepartment}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
