import React, { useState } from 'react';
import { 
  History, 
  X, 
  RotateCcw, 
  Clock, 
  User as UserIcon, 
  Plus, 
  Eye, 
  ChevronLeft, 
  Loader2, 
  FileText, 
  Image as ImageIcon,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { VersionSnapshot } from '../../types';
import { AuditLogPanel } from '../audit/AuditLogPanel';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: VersionSnapshot[];
  onRestoreSnapshot: (snapshot: VersionSnapshot) => Promise<void> | void;
  onCreateVersion?: (summary: string) => Promise<void>;
  onDeleteSnapshot?: (snapshot: VersionSnapshot) => Promise<void> | void;
  isLoading?: boolean;
  isRestoring?: boolean;
  articleId?: string;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  snapshots,
  onRestoreSnapshot,
  onCreateVersion,
  onDeleteSnapshot,
  isLoading = false,
  isRestoring = false,
  articleId,
}) => {
  // 탭 상태: 버전 스냅샷 vs 업무 활동 이력
  const [historyTab, setHistoryTab] = useState<'versions' | 'audit'>('versions');
  // 미리보기 대상 버전 상태
  const [previewSnap, setPreviewSnap] = useState<VersionSnapshot | null>(null);
  // 새 버전 만들기 인라인 폼 상태
  const [isCreating, setIsCreating] = useState(false);
  const [summaryInput, setSummaryInput] = useState('');
  const [isSubmittingVersion, setIsSubmittingVersion] = useState(false);

  if (!isOpen) return null;

  // 새 버전 생성 핸들러
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateVersion || isSubmittingVersion) return;

    try {
      setIsSubmittingVersion(true);
      await onCreateVersion(summaryInput.trim() || '수동 버전 저장');
      setSummaryInput('');
      setIsCreating(false);
    } catch (err) {
      console.error('[VersionHistoryModal] Error creating version:', err);
    } finally {
      setIsSubmittingVersion(false);
    }
  };

  // 복원 실행 확인
  const handleRestoreClick = (snap: VersionSnapshot) => {
    if (isRestoring) return;
    const vName = snap.versionNumber ? `v${snap.versionNumber}` : snap.timestamp;
    const isConfirmed = window.confirm(
      `"${vName}" 버전으로 기사를 복원하시겠습니까?\n\n※ 안전을 위해 현재 작성 중인 상태가 새로운 백업 버전으로 먼저 자동 저장된 후 안전하게 복원됩니다.`
    );
    if (isConfirmed) {
      onRestoreSnapshot(snap);
    }
  };

  // 삭제 확인 (되돌릴 수 없음)
  const handleDeleteClick = async (snap: VersionSnapshot) => {
    if (!onDeleteSnapshot) return;
    const vName = snap.versionNumber ? `v${snap.versionNumber}` : snap.timestamp;
    const ok = window.confirm(
      `"${vName}" 수정이력을 삭제하시겠습니까?\n\n※ 삭제하면 되돌릴 수 없습니다. 삭제 사실은 업무 활동 이력에 남습니다.`
    );
    if (!ok) return;
    await onDeleteSnapshot(snap);
    setPreviewSnap(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl border border-slate-300 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold">기사 Version History (수정이력)</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              Supabase 영속화
            </span>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 탭 바: 버전 이력 vs 업무 활동 이력 */}
        <div className="flex border-b border-slate-200 bg-slate-100 px-4 pt-2 space-x-2">
          <button
            type="button"
            onClick={() => setHistoryTab('versions')}
            className={`px-3 py-1.5 text-xs font-bold rounded-t border-t border-x transition-colors cursor-pointer ${
              historyTab === 'versions'
                ? 'bg-white text-blue-700 border-slate-200 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            기사 버전 이력 (스냅샷)
          </button>
          <button
            type="button"
            onClick={() => setHistoryTab('audit')}
            className={`px-3 py-1.5 text-xs font-bold rounded-t border-t border-x transition-colors cursor-pointer ${
              historyTab === 'audit'
                ? 'bg-white text-blue-700 border-slate-200 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent'
            }`}
          >
            업무 활동 이력 (작업 로그)
          </button>
        </div>

        {historyTab === 'audit' ? (
          <div className="p-4 overflow-y-auto flex-1">
            <AuditLogPanel articleId={articleId || ''} />
          </div>
        ) : (
          /* Content Container */
          <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
            {/* 1. 상단 안내 및 새 버전 저장 바 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <p className="text-slate-600 font-semibold text-xs">
                의미 있는 편집 시점과 복원 이력이 기록된 스냅샷 목록입니다.
              </p>
              <p className="text-slate-400 text-[11px] mt-0.5">
                복원 시 현재 기사 상태가 새 백업 버전으로 자동 저장되어 언제든 이전 상태로 재복원할 수 있습니다.
              </p>
            </div>

            {onCreateVersion && !previewSnap && !isCreating && (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-2xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>새 버전 저장</span>
              </button>
            )}
          </div>

          {/* 1-1. 새 버전 저장 인라인 폼 */}
          {isCreating && !previewSnap && (
            <form onSubmit={handleCreateSubmit} className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-blue-900 flex items-center space-x-1">
                  <Plus className="w-3.5 h-3.5" />
                  <span>현재 기사 상태를 새 버전으로 기록</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  취소
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={summaryInput}
                  onChange={(e) => setSummaryInput(e.target.value)}
                  placeholder="버전 생성 사유 (예: 1차 데스크 검토 반영, 조세소위 통계 보강)"
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSubmittingVersion}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-xs flex items-center space-x-1 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingVersion ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>저장 중...</span>
                    </>
                  ) : (
                    <span>저장</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* 2. 미리보기 화면 (Preview Mode) */}
          {previewSnap ? (
            <div className="space-y-3 animate-in fade-in duration-150">
              {/* Preview Header */}
              <div className="flex items-center justify-between bg-slate-100 p-2.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPreviewSnap(null)}
                  className="flex items-center space-x-1 text-slate-600 hover:text-slate-900 font-bold text-xs transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>목록으로 돌아가기</span>
                </button>

                <div className="flex items-center space-x-2">
                  <span className="text-[11px] text-slate-500">
                    {previewSnap.timestamp} · {previewSnap.author}
                  </span>
                  <button
                    type="button"
                    disabled={isRestoring}
                    onClick={() => handleRestoreClick(previewSnap)}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs flex items-center space-x-1 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>이 버전으로 복원</span>
                  </button>
                </div>
              </div>

              {/* Preview Article Content */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 font-sans max-h-[50vh] overflow-y-auto">
                <div>
                  <div className="flex items-center space-x-2 text-[10px] text-blue-700 font-mono font-semibold mb-1">
                    <span>{previewSnap.versionNumber ? `Version ${previewSnap.versionNumber}` : '버전 스냅샷'}</span>
                    <span>•</span>
                    <span>{previewSnap.summary}</span>
                  </div>
                  <h4 className="text-base font-bold text-slate-900">
                    {previewSnap.title || previewSnap.snapshotData?.article?.title || '제목 없음'}
                  </h4>
                  {(previewSnap.subtitle || previewSnap.snapshotData?.article?.subtitle) && (
                    <p className="text-xs text-slate-600 mt-1">
                      {previewSnap.subtitle || previewSnap.snapshotData?.article?.subtitle}
                    </p>
                  )}
                </div>

                <hr className="border-slate-200" />

                {/* Blocks Preview */}
                <div className="space-y-2.5 text-xs text-slate-800 leading-relaxed">
                  {previewSnap.snapshotData?.blocks && previewSnap.snapshotData.blocks.length > 0 ? (
                    previewSnap.snapshotData.blocks.map((block: any, bIdx: number) => (
                      <div key={block.id || bIdx} className="p-2 bg-white rounded border border-slate-200/80">
                        {block.type === 'paragraph' ? (
                          <p className="whitespace-pre-wrap">{block.text || '(빈 문단)'}</p>
                        ) : (
                          <div className="flex items-center space-x-2 text-slate-600 text-[11px]">
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                            <span className="font-semibold">[{block.type === 'video' ? '영상 미디어' : '보도사진'}]</span>
                            <span className="truncate">{block.caption || block.media_url || '미디어 블록'}</span>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400 italic">상세 블록 데이터가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* 3. 버전 목록 (List Mode) */
            <div className="space-y-2.5">
              {isLoading ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" />
                  <p className="text-xs font-semibold">버전 이력을 불러오는 중입니다...</p>
                </div>
              ) : snapshots.length === 0 ? (
                <div className="py-10 text-center text-slate-400 space-y-1">
                  <History className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600">저장된 버전 이력이 없습니다.</p>
                  <p className="text-[11px]">상단의 [새 버전 저장] 버튼을 눌러 첫 번째 버전을 기록하세요.</p>
                </div>
              ) : (
                snapshots.map((snap, idx) => {
                  const isCurrent = idx === 0;
                  return (
                    <div
                      key={snap.id}
                      className={`p-3.5 rounded-lg border transition-all ${
                        isCurrent
                          ? 'border-slate-400 bg-slate-50/80 ring-1 ring-slate-300 shadow-2xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-2xs'
                      }`}
                    >
                      {/* Top Bar: Version Label, Timestamp, Author */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 flex items-center space-x-1.5 text-xs">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{snap.timestamp}</span>
                          </span>
                          {snap.versionNumber && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-800">
                              v{snap.versionNumber}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-900 text-white flex items-center space-x-0.5">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>현재 버전</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1 text-slate-500 font-medium text-[11px]">
                          <UserIcon className="w-3 h-3 text-slate-400" />
                          <span>{snap.author}</span>
                        </div>
                      </div>

                      {/* Summary Description */}
                      <p className="text-slate-800 font-medium text-xs bg-white p-2 rounded border border-slate-200/90 leading-relaxed">
                        {snap.summary}
                      </p>

                      {/* Bottom Bar: Stats & Action Buttons */}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                        <div className="flex items-center space-x-2 font-mono">
                          <span className="flex items-center space-x-1">
                            <FileText className="w-3 h-3 text-slate-400" />
                            <span>블록 {snap.blocksCount}개</span>
                          </span>
                          <span>•</span>
                          <span>글자수 약 {snap.wordCount.toLocaleString()}자</span>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          {/* 미리보기 버튼 */}
                          <button
                            type="button"
                            onClick={() => setPreviewSnap(snap)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 flex items-center space-x-1 transition-colors cursor-pointer"
                            title="이 버전의 본문과 메타데이터를 확인합니다"
                          >
                            <Eye className="w-3 h-3 text-slate-500" />
                            <span>미리보기</span>
                          </button>

                          {/* 복원 버튼 (현재 버전이 아닐 때만 제공) */}
                          {!isCurrent && (
                            <button
                              type="button"
                              disabled={isRestoring}
                              onClick={() => handleRestoreClick(snap)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:text-amber-900 hover:bg-amber-50 rounded border border-amber-300 flex items-center space-x-1 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3 text-amber-600" />
                              <span>복원</span>
                            </button>
                          )}

                          {/* 삭제 버튼 */}
                          {onDeleteSnapshot && (
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(snap)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:text-rose-900 hover:bg-rose-50 rounded border border-rose-200 flex items-center space-x-1 transition-colors cursor-pointer"
                              title="이 수정이력을 삭제합니다 (되돌릴 수 없음)"
                            >
                              <Trash2 className="w-3 h-3 text-rose-500" />
                              <span>삭제</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
          </div>
        )}

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {snapshots.length}개의 버전 기록 보유
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors shadow-xs cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
