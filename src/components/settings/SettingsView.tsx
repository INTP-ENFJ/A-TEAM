import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  Sparkles, 
  Image as ImageIcon, 
  User as UserIcon, 
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { User, isHrAdmin } from '../../types';
import { GeneralSettings } from './GeneralSettings';
import { AiApiSettings } from './AiApiSettings';
import { MediaSettings } from './MediaSettings';
import { AccountSettings } from './AccountSettings';

interface SettingsViewProps {
  currentUser: User;
  onUpdateUser?: (updated: User) => void;
}

type SettingsTab = 'general' | 'ai-api' | 'media' | 'account';

interface NavItem {
  id: SettingsTab;
  label: string;
  subLabel: string;
  icon: React.ReactNode;
  badge?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser, onUpdateUser }) => {
  const hrOnly = isHrAdmin(currentUser);
  const [activeTab, setActiveTab] = useState<SettingsTab>(hrOnly ? 'account' : 'ai-api');

  const navItems: NavItem[] = [
    {
      id: 'general',
      label: 'General',
      subLabel: '일반 환경 및 보도 규칙',
      icon: <SlidersHorizontal className="w-4 h-4" />,
    },
    {
      id: 'ai-api',
      label: 'AI API',
      subLabel: 'LLM 공급자 및 모델 연동',
      icon: <Sparkles className="w-4 h-4 text-blue-500" />,
      badge: 'Prototype',
    },
    {
      id: 'media',
      label: 'Media',
      subLabel: '사진·영상 규격 및 최적화',
      icon: <ImageIcon className="w-4 h-4" />,
    },
    {
      id: 'account',
      label: 'Account',
      subLabel: '내 프로필 관리',
      icon: <UserIcon className="w-4 h-4" />,
    },
  ];

  // 인사 담당자는 프로필(계정)만 사용: AI·미디어·보도 규칙 설정은 숨김
  const visibleNavItems = hrOnly ? navItems.filter((n) => n.id === 'account') : navItems;

  return (
    <div className="flex-1 bg-slate-100 flex flex-col overflow-hidden select-text">
      {/* Top Breadcrumb Header */}
      <div className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs">
          <span className="font-bold text-slate-500">환경 설정 (Settings)</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-bold text-slate-900">
            {navItems.find(n => n.id === activeTab)?.label}
          </span>
          <span className="text-slate-500">
            ({navItems.find(n => n.id === activeTab)?.subLabel})
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
          <span>CMS CONFIG v2.4</span>
        </div>
      </div>

      {/* Main Settings Layout: Left Submenu + Right Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Submenu */}
        <aside className="w-56 md:w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0">
          <div className="p-3 space-y-1">
            <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              설정 메뉴
            </div>

            {visibleNavItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`tab-settings-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-semibold text-left transition-all ${
                    isActive
                      ? 'bg-slate-100 text-slate-900 border-l-2 border-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <div className={`${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                      {item.icon}
                    </div>
                    <div className="truncate">
                      <div className="leading-tight">{item.label}</div>
                      <div className="text-xs text-slate-400 font-normal truncate mt-0.5">
                        {item.subLabel}
                      </div>
                    </div>
                  </div>

                  {item.badge && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick System Info in sidebar footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 space-y-1.5 font-medium">
            <div className="flex items-center justify-between">
              <span>CMS Core</span>
              <span className="font-semibold text-slate-700">v2.4-ed</span>
            </div>
            <div className="flex items-center justify-between">
              <span>AI Engine</span>
              <span className="font-semibold text-slate-700">Active</span>
            </div>
          </div>
        </aside>

        {/* Right Settings Content Area */}
        <main className="flex-1 bg-slate-50 overflow-y-auto p-6 md:p-8">
          <div className="max-w-4xl mx-auto">
            {activeTab === 'general' && (
              <GeneralSettings currentUser={currentUser} />
            )}

            {activeTab === 'ai-api' && (
              <AiApiSettings currentUser={currentUser} />
            )}

            {activeTab === 'media' && (
              <MediaSettings />
            )}

            {activeTab === 'account' && (
              <AccountSettings currentUser={currentUser} onUpdateUser={onUpdateUser} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
