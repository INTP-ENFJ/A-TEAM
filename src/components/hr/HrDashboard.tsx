import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Building2, 
  Briefcase, 
  ShieldCheck, 
  Clock,
  KeyRound,
  History
} from 'lucide-react';
import { User } from '../../types';
import { supabase } from '../../lib/supabase';
import { SignupApprovalTab } from './SignupApprovalTab';
import { DepartmentManagementTab } from './DepartmentManagementTab';
import { PositionTitleManagementTab } from './PositionTitleManagementTab';
import { EmployeeManagementTab } from './EmployeeManagementTab';
import { PasswordResetRequestsTab } from './PasswordResetRequestsTab';
import { HrAuditLogTab } from './HrAuditLogTab';

interface HrDashboardProps {
  currentUser: User;
}

export const HrDashboard: React.FC<HrDashboardProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'approval' | 'departments' | 'positions' | 'password_reset' | 'audit'>('employees');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pendingResetCount, setPendingResetCount] = useState<number>(0);

  // 미처리 분실 신고 건수 조회
  const loadPendingResetCount = async () => {
    try {
      const { count, error } = await supabase
        .from('password_reset_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (!error && count !== null) {
        setPendingResetCount(count);
      }
    } catch (e) {
      // 무시
    }
  };

  useEffect(() => {
    loadPendingResetCount();
  }, []);

  // 알림센터에서 "가입 승인 요청"을 누르면 해당 메뉴로 이동
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (tab === 'approval' || tab === 'employees' || tab === 'audit') setActiveTab(tab);
    };
    window.addEventListener('press-cms:open-hr-tab', handler);
    return () => window.removeEventListener('press-cms:open-hr-tab', handler);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-900 text-slate-100">
      {/* 1. HR 전용 사이드바 */}
      <aside className="w-60 bg-slate-950 border-r border-slate-800 flex flex-col justify-between select-none shrink-0 h-full p-3">
        <div className="space-y-6">
          {/* 워크스페이스 타이틀 */}
          <div className="px-3 pt-2">
            <div className="flex items-center space-x-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              <span>인사관리 워크스페이스</span>
            </div>
            <p className="text-[12px] text-slate-400 mt-1">
              언론사 조직·직책 및 가입 승인 포털
            </p>
          </div>

          {/* HR 메뉴 목록 */}
          <nav className="space-y-1">
            <button
              type="button"
              id="hr-nav-employees"
              onClick={() => setActiveTab('employees')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'employees'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Users className="w-4 h-4 shrink-0" />
                <span>직원 관리 (명부)</span>
              </div>
            </button>

            <button
              type="button"
              id="hr-nav-approval"
              onClick={() => setActiveTab('approval')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'approval'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Clock className="w-4 h-4 shrink-0" />
                <span>가입 승인 관리</span>
              </div>
            </button>

            <button
              type="button"
              id="hr-nav-password-reset"
              onClick={() => setActiveTab('password_reset')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'password_reset'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <KeyRound className="w-4 h-4 shrink-0" />
                <span>비밀번호 분실 신고</span>
              </div>
              {pendingResetCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[12px] font-bold bg-amber-500 text-slate-950">
                  {pendingResetCount}
                </span>
              )}
            </button>

            <button
              type="button"
              id="hr-nav-departments"
              onClick={() => setActiveTab('departments')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'departments'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Building2 className="w-4 h-4 shrink-0" />
                <span>부서 및 조직 관리</span>
              </div>
            </button>

            <button
              type="button"
              id="hr-nav-positions"
              onClick={() => setActiveTab('positions')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'positions'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Briefcase className="w-4 h-4 shrink-0" />
                <span>직책 마스터 관리</span>
              </div>
            </button>

            <button
              type="button"
              id="hr-nav-audit"
              onClick={() => setActiveTab('audit')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <History className="w-4 h-4 shrink-0" />
                <span>인사·권한 변경 기록</span>
              </div>
            </button>
          </nav>
        </div>

        {/* 하단 관리자 정보 카드 */}
        <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 text-[12px] text-slate-400 space-y-1">
          <div className="flex items-center justify-between font-semibold text-slate-300">
            <span>{currentUser.name}</span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">인사관리자</span>
          </div>
          <div className="truncate text-slate-500">{currentUser.email}</div>
          <div className="text-[12px] text-slate-400 pt-1">
            소속: {currentUser.department} ({currentUser.roleTitle || '관리자'})
          </div>
        </div>
      </aside>

      {/* 2. 중앙 컨텐츠 영역 */}
      <main className="flex-1 overflow-y-auto p-6 bg-slate-900">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'employees' && (
            <EmployeeManagementTab onShowToast={showToast} />
          )}

          {activeTab === 'approval' && (
            <SignupApprovalTab onShowToast={showToast} />
          )}

          {activeTab === 'password_reset' && (
            <PasswordResetRequestsTab 
              onShowToast={showToast} 
              onRequestCountChange={setPendingResetCount}
            />
          )}

          {activeTab === 'departments' && (
            <DepartmentManagementTab onShowToast={showToast} />
          )}

          {activeTab === 'audit' && <HrAuditLogTab />}

          {activeTab === 'positions' && (
            <PositionTitleManagementTab onShowToast={showToast} />
          )}
        </div>
      </main>

      {/* 플로팅 토스트 알림 */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 bg-slate-950 text-slate-100 px-4 py-2.5 rounded-md shadow-xl border border-slate-700 text-xs flex items-center space-x-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150 font-medium"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
