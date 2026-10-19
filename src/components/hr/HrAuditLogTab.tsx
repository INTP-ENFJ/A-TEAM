import React, { useEffect, useState } from 'react';
import { History, Loader2, RefreshCw, User as UserIcon, Building2, Briefcase } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface HrAuditRow {
  id: string;
  actorName: string;
  entity: 'profile' | 'department' | 'position_title';
  summary: string;
  createdAt: string;
}

const ENTITY_LABEL: Record<HrAuditRow['entity'], string> = {
  profile: '직원 정보',
  department: '부서',
  position_title: '직책',
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const HrAuditLogTab: React.FC = () => {
  const [rows, setRows] = useState<HrAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('hr_audit_logs')
        .select('id, entity, summary, created_at, actor:profiles!hr_audit_logs_actor_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (err) throw err;
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          actorName: r.actor?.name || '시스템',
          entity: r.entity,
          summary: r.summary,
          createdAt: r.created_at,
        }))
      );
    } catch (e: any) {
      console.error('[HrAuditLogTab] load error:', e);
      setError('변경 기록을 불러오지 못했습니다. 관리자에게 문의해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const icon = (e: HrAuditRow['entity']) =>
    e === 'profile' ? <UserIcon className="w-3.5 h-3.5" /> : e === 'department' ? <Building2 className="w-3.5 h-3.5" /> : <Briefcase className="w-3.5 h-3.5" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <History className="w-5 h-5 text-blue-400" />
            <span>인사·권한 변경 기록</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            직원 정보(부서·직책·권한 등), 부서, 직책이 바뀔 때마다 누가 언제 바꿨는지 자동으로 남습니다. 최근 200건까지 보여 줍니다.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>새로고침</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          불러오는 중…
        </div>
      ) : error ? (
        <div className="p-4 rounded-md bg-rose-950/40 border border-rose-900 text-rose-300 text-xs">{error}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-slate-500 text-xs border border-dashed border-slate-700 rounded-md">
          아직 기록이 없습니다. 부서·직책·직원 정보가 바뀌면 여기에 쌓입니다.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 border border-slate-800 rounded-md bg-slate-950/40">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-start space-x-3">
              <span className="mt-0.5 text-blue-300">{icon(r.entity)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-100 break-words">{r.summary}</p>
                <p className="text-[12px] text-slate-500 mt-1">
                  {ENTITY_LABEL[r.entity]} · 변경한 사람: {r.actorName} · {formatDateTime(r.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
