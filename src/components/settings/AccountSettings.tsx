import React, { useState } from 'react';
import { 
  User as UserIcon, 
  Save, 
  Check, 
  Award,
  Camera,
  Upload,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Move
} from 'lucide-react';
import { User, isHrAdmin } from '../../types';
import { PasswordChangeBox } from './PasswordChangeBox';

interface AccountSettingsProps {
  currentUser: User;
  onUpdateUser?: (updated: User) => void;
}

export const AccountSettings: React.FC<AccountSettingsProps> = ({ currentUser, onUpdateUser }) => {
  const [name, setName] = useState(currentUser.name);
  const department = currentUser.department || '산업부';
  const roleTitle = currentUser.roleTitle || '정규 출입기자';
  const [email, setEmail] = useState(currentUser.email);
  const [recoveryEmail, setRecoveryEmail] = useState(currentUser.recoveryEmail || '');
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [pressCardNumber, setPressCardNumber] = useState('PRESS-KOR-2024-0891');
  const [isSaved, setIsSaved] = useState(false);

  // 프로필 사진 조절(크롭/줌/팬) 모달 상태
  const [rawUploadSrc, setRawUploadSrc] = useState<string | null>(null);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // 사진 파일 선택 시 바로 저장하지 않고 조절 창 열기
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const rawDataUrl = loadEvt.target?.result as string;
        if (!rawDataUrl) return;
        setRawUploadSrc(rawDataUrl);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setIsAdjustModalOpen(true);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  // 원형 영역에 맞게 캔버스에서 잘라내어 저장
  const handleApplyCroppedAvatar = () => {
    if (!rawUploadSrc) return;
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const maskSize = 240;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scaleFactor = size / maskSize;
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const baseW = img.width;
      const baseH = img.height;
      const coverScale = Math.max(maskSize / baseW, maskSize / baseH);
      const drawnW = baseW * coverScale * zoom * scaleFactor;
      const drawnH = baseH * coverScale * zoom * scaleFactor;

      const centerX = size / 2 + pan.x * scaleFactor;
      const centerY = size / 2 + pan.y * scaleFactor;

      ctx.drawImage(img, centerX - drawnW / 2, centerY - drawnH / 2, drawnW, drawnH);
      ctx.restore();

      const cropped = canvas.toDataURL('image/jpeg', 0.9);
      setAvatar(cropped);
      setIsAdjustModalOpen(false);
      setRawUploadSrc(null);
    };
    img.src = rawUploadSrc;
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedUser: User = {
      ...currentUser,
      name,
      department: currentUser.department,
      roleTitle: currentUser.roleTitle,
      email,
      recoveryEmail,
      avatar,
    };
    if (onUpdateUser) {
      onUpdateUser(updatedUser);
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <UserIcon className="w-5 h-5 text-blue-600" />
            <span>기자 계정 프로필 (Account Settings)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            기사 하단 및 독자에게 노출되는 기자 프로필 서식 및 출입처 부서 정보를 설정합니다.
          </p>
        </div>

        {isSaved && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-xs font-bold animate-fade-in shadow-xs">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>프로필이 성공적으로 저장되었습니다!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs text-slate-700">
        {/* Profile Details */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Award className="w-4 h-4 text-blue-600" />
            <h3>기자 프로필 정보 (Reporter Profile)</h3>
          </div>

          <div className="flex items-center space-x-4 pb-2">
            <div className="relative group">
              {avatar ? (
                <img 
                  src={avatar} 
                  alt={name} 
                  onError={() => setAvatar('')}
                  className="w-16 h-16 rounded-full object-cover border-2 border-slate-200 shadow-2xs"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xl border-2 border-slate-200 shadow-2xs">
                  {name ? name.slice(0, 1) : '기'}
                </div>
              )}
              <label 
                htmlFor="avatar-upload"
                className="absolute inset-0 rounded-full bg-black/40 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[12px]"
                title="프로필 사진 변경"
              >
                <Camera className="w-4 h-4 mb-0.5" />
                <span>변경</span>
              </label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm flex items-center space-x-2">
                <span>{name}</span>
                <span className="text-[12px] font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {isHrAdmin(currentUser) ? '인사 관리자' : currentUser.role === 'reporter' ? '정규 출입기자' : '데스크 에디터'}
                </span>
              </div>
              <span className="text-[12px] text-slate-500 mt-0.5 block">{email}</span>
              <label 
                htmlFor="avatar-upload"
                className="inline-flex items-center space-x-1 mt-1.5 text-blue-600 hover:text-blue-700 font-semibold cursor-pointer text-[12px]"
              >
                <Upload className="w-3 h-3" />
                <span>사진 파일 업로드</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{isHrAdmin(currentUser) ? '이름' : '기자 실명'}</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">소속 부서 (읽기 전용)</label>
              <input
                type="text"
                readOnly
                value={department}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-slate-50 text-xs text-slate-500 cursor-not-allowed shadow-2xs"
              />
              <span className="text-[12px] text-slate-400 mt-1 block">소속부서와 직책은 인사 담당자가 관리합니다.</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">직책 / 직급 (읽기 전용)</label>
              <input
                type="text"
                readOnly
                value={roleTitle}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-slate-50 text-xs text-slate-500 cursor-not-allowed shadow-2xs"
              />
              <span className="text-[12px] text-slate-400 mt-1 block">소속부서와 직책은 인사 담당자가 관리합니다.</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">대표 출고 이메일</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
              />
              <span className="text-[12px] text-slate-400 mt-1 block">독자 제보 및 피드백 수신 주소로 활용됩니다.</span>
            </div>

            <div>
              <label htmlFor="input-recovery-email" className="block font-semibold text-slate-700 mb-1">
                비밀번호 찾기용 이메일 (비상 연락용)
              </label>
              <input
                id="input-recovery-email"
                type="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="예: myname@naver.com, reporter@gmail.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
              />
              <span className="text-[12px] text-slate-400 mt-1 block">
                사내 비밀번호를 잊어버렸을 때 임시 비밀번호를 받거나 본인 확인을 할 수 있는 개인 이메일입니다.
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">언론인 등록 번호</label>
              <input
                type="text"
                value={pressCardNumber}
                onChange={(e) => setPressCardNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-slate-50 font-mono text-xs text-slate-700"
                readOnly
              />
              <span className="text-[12px] text-slate-400 mt-1 block">사내 인사팀 발급 고유 언론인 식별 ID</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-1">
          <button
            type="submit"
            id="btn-save-account-settings"
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-md font-bold text-xs shadow-2xs flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>설정 저장</span>
          </button>
        </div>
      </form>

      {/* 비밀번호 변경 */}
      <PasswordChangeBox email={currentUser.email} />

      {/* 사진 위치 및 크기 조절 모달 */}
      {isAdjustModalOpen && rawUploadSrc && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                  <Camera className="w-4 h-4 text-blue-600" />
                  <span>프로필 사진 맞추기</span>
                </h3>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  사진을 마우스로 끌어 이동하고, 아래 막대로 크기를 조절해 보세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAdjustModalOpen(false);
                  setRawUploadSrc(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Viewport Box */}
            <div className="p-6 bg-slate-900 flex flex-col items-center justify-center">
              <div 
                className="w-60 h-60 rounded-full border-4 border-white/90 shadow-2xl overflow-hidden relative cursor-grab active:cursor-grabbing bg-slate-800 flex items-center justify-center"
                onMouseDown={(e) => {
                  setIsDragging(true);
                  setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
                }}
                onMouseMove={(e) => {
                  if (isDragging) {
                    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
                  }
                }}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
              >
                <img
                  src={rawUploadSrc}
                  alt="조절 중인 사진"
                  draggable={false}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    maxWidth: 'none',
                    maxHeight: 'none',
                  }}
                  className="pointer-events-none select-none transition-transform duration-75 object-contain"
                />
                <div className="absolute inset-0 pointer-events-none rounded-full ring-1 ring-inset ring-black/20" />
              </div>
              <div className="mt-3 flex items-center space-x-1.5 text-[12px] text-slate-300">
                <Move className="w-3.5 h-3.5 text-blue-400" />
                <span>사진을 끌어서 원하는 위치로 옮겨주세요</span>
              </div>
            </div>

            {/* Controls */}
            <div className="p-5 space-y-4 bg-white">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center space-x-1">
                    <ZoomIn className="w-3.5 h-3.5 text-slate-500" />
                    <span>사진 크기 (확대 / 축소)</span>
                  </span>
                  <span className="font-mono text-slate-500">{Math.round(zoom * 100)}%</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                    title="축소"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min="0.5"
                    max="3.0"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="flex-1 accent-blue-600 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setZoom(prev => Math.min(3.0, prev + 0.1))}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                    title="확대"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer text-[12px] flex items-center space-x-1"
                    title="원래대로"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>초기화</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdjustModalOpen(false);
                    setRawUploadSrc(null);
                  }}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleApplyCroppedAvatar}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>이 모습으로 적용</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
