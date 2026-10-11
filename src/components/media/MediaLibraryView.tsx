import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Upload, X, Image as ImageIcon, Video, FilePlus2, Trash2, Loader2, Sparkles, ExternalLink, Save,
} from 'lucide-react';
import { MediaArticleUsage, MediaItem, User, isDeskUser } from '../../types';
import { mediaService } from '../../services/mediaService';
import { hasMyAiKey } from '../../services/aiKey';
import { PanelHeader, PANEL_BTN_PRIMARY, PANEL_BTN_SECONDARY } from '../editor/PanelHeader';
import { AiImageDialog } from './AiImageDialog';

/**
 * 미디어 라이브러리 (전용 탭 + 편집기 안에서 여는 큰 창 공용)
 * - 목록은 표 한 줄에 사진·제목·캡션·기자·이메일·부서가 보입니다.
 * - 사진 올리기: 이름·이메일·부서는 로그인 정보로 자동 입력됩니다.
 * - 캡션은 200자까지 (줄바꿈 가능).
 */

export const CAPTION_MAX = 200;

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  currentUser: User;
  mode: 'page' | 'picker';
  /** 좁은 오른쪽 창에서 쓸 때: 표 대신 카드 줄로 보여줌 */
  compact?: boolean;
  /** 지금 열어 둔 기사의 프로젝트 ('이 기사 프로젝트' 범위 + 올리기 기본값) */
  currentProjectId?: string | null;
  /** 기사를 열어 둔 상태에서만 [기사에 넣기] 표시 */
  canInsert: boolean;
  /** 사진 올릴 때 고를 수 있는 프로젝트 목록 */
  projects: ProjectOption[];
  isReadOnly?: boolean;
  onInsert: (items: MediaItem[]) => void;
  /** 목록 줄을 끌기 시작할 때 (편집기 놓는 자리 표시용) */
  onDragStartMedia?: (item: MediaItem) => void;
  /** 올리기·수정·삭제 후 (편집기 쪽 목록 새로고침용) */
  onChanged?: () => void;
  showToast: (message: string) => void;
  /** 편집기 본문에 끌어다 놓은 파일 (올리기 창을 열어 제목·캡션을 적게 함) */
  externalFiles?: File[];
  onExternalFilesConsumed?: () => void;
}

type TypeFilter = 'all' | 'image' | 'video';
type PeriodMode = 'all' | 'year' | 'month' | 'day';

const bylineOf = (u: User) => `${u.name} ${u.roleTitle || '기자'}`.trim();

export const MediaLibraryView: React.FC<Props> = ({
  currentUser, mode, compact = false, currentProjectId, canInsert, projects, isReadOnly = false,
  onInsert, onDragStartMedia, onChanged, showToast, externalFiles, onExternalFilesConsumed,
}) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  // 범위: 'all' | 'mine' | 'project' | 'dept:부서이름'
  const [scope, setScope] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [periodYear, setPeriodYear] = useState<string>(String(new Date().getFullYear()));
  const [periodMonth, setPeriodMonth] = useState<string>(''); // YYYY-MM
  const [periodDay, setPeriodDay] = useState<string>('');     // YYYY-MM-DD
  const [dropOver, setDropOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [deptList, setDeptList] = useState<{ id: string; name: string; parentId: string | null }[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  // AI로 만든 이미지: 출처·캡션 머리말을 올리기 창에 미리 넣음
  const [aiImageOpen, setAiImageOpen] = useState(false);
  const [aiImageMeta, setAiImageMeta] = useState<{ credit: string; caption: string } | null>(null);
  const [insertDefault, setInsertDefault] = useState(false);

  // 편집기 본문에 끌어다 놓은 파일: 곧장 올리지 않고 올리기 창에서 제목·캡션을 먼저 적게 함
  useEffect(() => {
    if (externalFiles && externalFiles.length > 0) {
      setDroppedFiles(externalFiles);
      setInsertDefault(true);
      setUploadOpen(true);
      onExternalFilesConsumed?.();
    }
  }, [externalFiles, onExternalFilesConsumed]);
  const [detail, setDetail] = useState<MediaItem | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const list = await mediaService.getLibraryMedia();
      setItems(list);
    } catch (e: any) {
      setError(e?.message || '목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 만들어 둔 부서 전체 (사진이 아직 없는 부서도 목록에 보이도록)
  useEffect(() => {
    mediaService.getActiveDepartments().then(setDeptList).catch(() => undefined);
  }, []);

  const afterChange = useCallback(async () => {
    await load(true);
    onChanged?.();
  }, [load, onChanged]);

  // 부서 드롭다운 목록: 상위 부서 아래에 하위 부서를 들여써서 보여줌
  //  + 사진에는 있지만 부서 목록에는 없는 이름(예전 부서)도 빠지지 않게 추가
  const deptOptions = useMemo(() => {
    const out: { name: string; label: string }[] = [];
    const known = new Set<string>();
    const roots = deptList.filter(d => !d.parentId);
    roots.forEach(r => {
      out.push({ name: r.name, label: r.name });
      known.add(r.name);
      deptList.filter(d => d.parentId === r.id).forEach(c => {
        out.push({ name: c.name, label: `└ ${c.name}` });
        known.add(c.name);
      });
    });
    // 상위가 목록에 없는 하위 부서
    deptList.filter(d => d.parentId && !roots.some(r => r.id === d.parentId) && !known.has(d.name)).forEach(d => {
      out.push({ name: d.name, label: d.name });
      known.add(d.name);
    });
    items.forEach(i => {
      if (i.uploaderDepartment && !known.has(i.uploaderDepartment)) {
        known.add(i.uploaderDepartment);
        out.push({ name: i.uploaderDepartment, label: i.uploaderDepartment });
      }
    });
    return out;
  }, [deptList, items]);

  // 상위 부서를 고르면 그 아래 하위 부서의 사진도 함께 보이도록 이름 묶음을 만듦
  const deptNamesFor = useCallback((name: string): Set<string> => {
    const set = new Set<string>([name]);
    const root = deptList.find(d => d.name === name && !d.parentId);
    if (root) deptList.filter(d => d.parentId === root.id).forEach(c => set.add(c.name));
    return set;
  }, [deptList]);

  // 목록에 있는 연도들 (기간-연도 선택용)
  const years = useMemo(() => {
    const set = new Set<string>([String(new Date().getFullYear())]);
    items.forEach(i => { if (i.createdAt) set.add(String(new Date(i.createdAt).getFullYear())); });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter(it => {
      if (typeFilter !== 'all' && it.type !== typeFilter) return false;
      if (scope === 'project' && (!currentProjectId || it.projectId !== currentProjectId)) return false;
      if (scope.startsWith('dept:') && !(it.uploaderDepartment && deptNamesFor(scope.slice(5)).has(it.uploaderDepartment))) return false;

      if (periodMode !== 'all') {
        if (!it.createdAt) return false;
        const d = new Date(it.createdAt);
        const y = String(d.getFullYear());
        const ym = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const ymd = `${ym}-${String(d.getDate()).padStart(2, '0')}`;
        if (periodMode === 'year' && periodYear && y !== periodYear) return false;
        if (periodMode === 'month' && periodMonth && ym !== periodMonth) return false;
        if (periodMode === 'day' && periodDay && ymd !== periodDay) return false;
      }

      if (q) {
        const hay = [it.title, it.caption, it.credit, it.uploaderName, it.uploaderEmail, it.uploaderDepartment, it.originalFilename]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // 최신순 고정
    return [...list].sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));
  }, [items, query, scope, typeFilter, periodMode, periodYear, periodMonth, periodDay, currentProjectId, deptNamesFor]);

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
      active ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col bg-slate-50 text-slate-800 relative ${dropOver ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
      onDragOver={(e) => {
        if (isReadOnly || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropOver(false);
      }}
      onDrop={(e) => {
        setDropOver(false);
        if (isReadOnly || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setDroppedFiles(Array.from(e.dataTransfer.files));
        setUploadOpen(true);
      }}
    >
      {dropOver && (
        <div className="absolute inset-0 z-10 bg-blue-50/80 flex items-center justify-center text-sm font-bold text-blue-700 pointer-events-none">
          여기에 놓으면 사진 올리기 창이 열립니다
        </div>
      )}
      {/* 머리글 (AI 도구 창과 같은 모양) */}
      <PanelHeader
        icon={<ImageIcon className="w-4 h-4" />}
        title="미디어 라이브러리"
        subtitle={`사진·영상을 검색하고 기사에 바로 넣을 수 있습니다 (${filtered.length}/${items.length}건)`}
        actions={!isReadOnly ? (
          <>
            <button type="button" onClick={() => setAiImageOpen(true)} className={PANEL_BTN_SECONDARY}>
              <Sparkles className="w-3 h-3" /> AI 이미지
            </button>
            <button type="button" onClick={() => setUploadOpen(true)} className={PANEL_BTN_PRIMARY}>
              <Upload className="w-3 h-3" /> 사진 올리기
            </button>
          </>
        ) : undefined}
      />

      {/* 검색·필터 */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-2.5 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목·캡션·기자 이름·이메일·부서 검색"
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-md text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="font-bold text-slate-700">범위</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-white min-w-28">
              <option value="all">전체</option>
              {currentProjectId && <option value="project">이 기사 프로젝트</option>}
              {deptOptions.length > 0 && (
                <optgroup label="부서">
                  {deptOptions.map(d => <option key={d.name} value={`dept:${d.name}`}>{d.label}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-700">종류</span>
            <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-md">
              <button type="button" className={chip(typeFilter === 'all')} onClick={() => setTypeFilter('all')}>전체</button>
              <button type="button" className={chip(typeFilter === 'image')} onClick={() => setTypeFilter('image')}>사진</button>
              <button type="button" className={chip(typeFilter === 'video')} onClick={() => setTypeFilter('video')}>영상</button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-700">기간</span>
            <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value as PeriodMode)} className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-white">
              <option value="all">전체</option>
              <option value="year">연도</option>
              <option value="month">연·월</option>
              <option value="day">연·월·일</option>
            </select>
            {periodMode === 'year' && (
              <select value={periodYear} onChange={(e) => setPeriodYear(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-white">
                {years.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            )}
            {periodMode === 'month' && (
              <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-white" />
            )}
            {periodMode === 'day' && (
              <input type="date" value={periodDay} onChange={(e) => setPeriodDay(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-white" />
            )}
          </div>
        </div>
      </div>

      {/* 목록 표 */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-rose-700">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-600">조건에 맞는 사진이 없습니다.</div>
        ) : (
          compact ? (
            <ul className="space-y-2">
              {filtered.map(it => {
                const draggable = canInsert && mode === 'picker';
                return (
                  <li
                    key={it.id}
                    className="bg-white border border-slate-200 rounded-lg p-2.5 flex gap-2.5 hover:border-slate-300 cursor-pointer"
                    onClick={() => setDetail(it)}
                    draggable={draggable}
                    onDragStart={(e) => {
                      if (!draggable) return;
                      const { type: mediaType, ...rest } = it;
                      const payload = JSON.stringify({ type: 'media-library-item', mediaType, ...rest });
                      e.dataTransfer.setData('application/x-press-cms-media', payload);
                      e.dataTransfer.setData('text/plain', payload);
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStartMedia?.(it);
                    }}
                    title={draggable ? '본문으로 끌어다 놓으면 기사에 들어갑니다' : undefined}
                  >
                    <div className="w-20 h-14 rounded bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                      {it.type === 'image' && it.url ? (
                        <img src={it.url} alt="" className="w-full h-full object-cover" draggable={false} />
                      ) : (
                        <Video className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 line-clamp-1 break-all">{it.title}</div>
                      <div className="text-[11px] text-slate-600 line-clamp-2 whitespace-pre-line break-words">{it.caption || '캡션 없음'}</div>
                      <div className="mt-0.5 text-[11px] text-slate-700 truncate">{it.uploaderName || '-'} · {it.uploaderDepartment || '-'}</div>
                      <div className="text-[10px] text-slate-500 truncate">{it.uploaderEmail || ''}</div>
                    </div>
                    {canInsert && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onInsert([it]); }}
                        className={`${PANEL_BTN_PRIMARY} self-center shrink-0`}
                      >
                        넣기
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr className="text-left">
                  <th className="px-3 py-2 font-bold w-24">사진</th>
                  <th className="px-3 py-2 font-bold w-48">제목</th>
                  <th className="px-3 py-2 font-bold">캡션</th>
                  <th className="px-3 py-2 font-bold w-28">기자</th>
                  <th className="px-3 py-2 font-bold w-48">이메일</th>
                  <th className="px-3 py-2 font-bold w-24">부서</th>
                  <th className="px-3 py-2 font-bold w-40 text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(it => (
                  <tr
                    key={it.id}
                    className="hover:bg-slate-50 align-middle cursor-pointer"
                    onClick={() => setDetail(it)}
                    draggable={canInsert && mode === 'picker'}
                    onDragStart={(e) => {
                      if (!(canInsert && mode === 'picker')) return;
                      // 편집기 본문에 끌어다 놓을 수 있도록 사진 정보를 함께 실음
                      const { type: mediaType, ...rest } = it;
                      const payload = JSON.stringify({ type: 'media-library-item', mediaType, ...rest });
                      e.dataTransfer.setData('application/x-press-cms-media', payload);
                      e.dataTransfer.setData('text/plain', payload);
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStartMedia?.(it);
                    }}
                    title={canInsert && mode === 'picker' ? '본문으로 끌어다 놓으면 기사에 들어갑니다' : undefined}
                  >
                    <td className="px-3 py-2">
                      <div className="w-20 h-12 rounded bg-slate-100 overflow-hidden flex items-center justify-center">
                        {it.type === 'image' && it.url ? (
                          <img src={it.url} alt="" className="w-full h-full object-cover" draggable={false} />
                        ) : (
                          <Video className="w-5 h-5 text-slate-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900"><div className="line-clamp-2 break-all">{it.title}</div></td>
                    <td className="px-3 py-2 text-slate-700" title={it.caption || ''}>
                      <div className="line-clamp-2 whitespace-pre-line break-words">{it.caption || '-'}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{it.uploaderName || '-'}</td>
                    <td className="px-3 py-2 text-slate-700 break-all">{it.uploaderEmail || '-'}</td>
                    <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{it.uploaderDepartment || '-'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {canInsert && (
                        <button
                          type="button"
                          onClick={() => onInsert([it])}
                          className={PANEL_BTN_PRIMARY}
                        >
                          기사에 넣기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        )}
      </div>

      {uploadOpen && (
        <UploadDialog
          currentUser={currentUser}
          uploadProjectId={mode === 'picker' && currentProjectId && projects.some(p => p.id === currentProjectId) ? currentProjectId : null}
          inEditor={mode === 'picker'}
          initialFiles={droppedFiles}
          creditOverride={aiImageMeta?.credit}
          initialCaption={aiImageMeta?.caption}
          offerInsert={canInsert}
          insertDefault={insertDefault}
          onClose={() => { setUploadOpen(false); setDroppedFiles([]); setInsertDefault(false); setAiImageMeta(null); }}
          onDone={async (uploaded, insertNow) => {
            setUploadOpen(false);
            setDroppedFiles([]);
            setInsertDefault(false);
            setAiImageMeta(null);
            showToast(`${uploaded.length}개의 미디어를 올렸습니다.`);
            await afterChange();
            if (insertNow && uploaded.length > 0) onInsert(uploaded);
          }}
        />
      )}

      {aiImageOpen && (
        <AiImageDialog
          onClose={() => setAiImageOpen(false)}
          onUse={(r) => {
            setAiImageOpen(false);
            setAiImageMeta({ credit: r.credit, caption: r.caption });
            setDroppedFiles([r.file]);
            setInsertDefault(false);
            setUploadOpen(true);
          }}
        />
      )}

      {detail && (
        <DetailDialog
          item={detail}
          currentUser={currentUser}
          canInsert={canInsert}
          isReadOnly={isReadOnly}
          onClose={() => setDetail(null)}
          onInsert={(it) => { setDetail(null); onInsert([it]); }}
          onChanged={async () => { await afterChange(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 사진 올리기                                                         */
/* ------------------------------------------------------------------ */

interface UploadRow { file: File; title: string; caption: string; preview: string; }

const makeRow = (f: File, caption = ''): UploadRow => ({
  file: f,
  title: f.name.replace(/\.[^/.]+$/, ''),
  caption,
  preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
});

const UploadDialog: React.FC<{
  currentUser: User;
  /** 사진부 등 기사 밖에서 올리면 null (프로젝트 없이 라이브러리에 보관) */
  uploadProjectId: string | null;
  inEditor: boolean;
  initialFiles?: File[];
  /** AI로 만든 이미지일 때 출처에 쓸 글 (없으면 로그인한 기자 이름) */
  creditOverride?: string;
  /** 캡션 첫머리에 미리 넣을 글 (예: [AI 생성 이미지]) */
  initialCaption?: string;
  offerInsert: boolean;
  insertDefault: boolean;
  onClose: () => void;
  onDone: (items: MediaItem[], insertNow: boolean) => void | Promise<void>;
}> = ({ currentUser, uploadProjectId, inEditor, initialFiles, creditOverride, initialCaption, offerInsert, insertDefault, onClose, onDone }) => {
  const [rows, setRows] = useState<UploadRow[]>(() => (initialFiles || []).map(f => makeRow(f, initialCaption || '')));
  const [insertNow, setInsertNow] = useState(insertDefault);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<UploadRow[]>(rows);
  rowsRef.current = rows;

  // 닫을 때 미리보기 주소 정리
  useEffect(() => () => { rowsRef.current.forEach(r => r.preview && URL.revokeObjectURL(r.preview)); }, []);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setRows(prev => [...prev, ...Array.from(files).map(f => makeRow(f))]);
  };
  const removeRow = (i: number) => setRows(prev => {
    if (prev[i]?.preview) URL.revokeObjectURL(prev[i].preview);
    return prev.filter((_, k) => k !== i);
  });
  const patch = (i: number, p: Partial<UploadRow>) => setRows(prev => prev.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const submit = async () => {
    if (rows.length === 0) { setErr('올릴 사진을 먼저 골라 주세요.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const uploaded: MediaItem[] = [];
      for (const r of rows) {
        const item = await mediaService.uploadMedia(uploadProjectId, r.file, {
          title: r.title,
          caption: r.caption.trim() || undefined,
          credit: creditOverride || bylineOf(currentUser),
          uploader: { name: currentUser.name, email: currentUser.email, department: currentUser.department },
        });
        uploaded.push(item);
        if (item.type === 'image' && (await hasMyAiKey())) {
          // 내 AI 키가 있을 때만 사진 내용을 분석해 캡션 제안을 만들어 둠 (실패해도 올리기에는 영향 없음)
          mediaService.analyzeMediaImage(item.id, false).catch(() => undefined);
        }
      }
      await onDone(uploaded, offerInsert && insertNow);
    } catch (e: any) {
      setErr(e?.message || '올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = 'mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500';

  return (
    <div className="fixed inset-0 z-[9998] bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2"><FilePlus2 className="w-4 h-4 text-blue-600" /> 사진 올리기</div>
          <button type="button" disabled={busy} onClick={onClose} className="p-1 rounded hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

          {/* 사진 + 제목 + 캡션 (사진을 고르기 전에도 같은 모양으로 보임) */}
          {rows.length === 0 ? (
            <div className="p-3 border border-slate-200 rounded-lg space-y-2">
              <div className="font-semibold text-slate-700">사진</div>
              <button type="button" onClick={() => inputRef.current?.click()} className="w-full h-36 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:border-slate-400 cursor-pointer font-semibold">
                여기를 눌러 사진·영상 고르기 (여러 개 가능)
              </button>
              <label className="block"><span className="font-semibold text-slate-700">제목</span><input disabled placeholder="사진을 고르면 적을 수 있어요" className={fieldCls} /></label>
              <label className="block"><span className="font-semibold text-slate-700 flex justify-between"><span>캡션</span><span className="font-normal text-slate-500">0/{CAPTION_MAX}</span></span><textarea disabled rows={3} placeholder="사진을 고르면 적을 수 있어요" className={`${fieldCls} resize-none`} /></label>
            </div>
          ) : (
            <>
              {rows.map((r, i) => (
                <div key={i} className="p-3 border border-slate-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">사진 <span className="font-normal text-slate-500 truncate">{r.file.name}</span></span>
                    <button type="button" onClick={() => removeRow(i)} className="text-slate-500 hover:text-rose-600 cursor-pointer" title="빼기"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {r.preview
                    ? <img src={r.preview} alt="" className="w-full max-h-48 object-contain bg-slate-100 rounded" />
                    : <div className="w-full h-24 bg-slate-100 rounded flex items-center justify-center text-slate-600">영상 파일</div>}
                  <label className="block">
                    <span className="font-semibold text-slate-700">제목</span>
                    <input value={r.title} maxLength={60} onChange={(e) => patch(i, { title: e.target.value })} className={fieldCls} />
                  </label>
                  <label className="block">
                    <span className="font-semibold text-slate-700 flex justify-between">
                      <span>캡션</span>
                      <span className={`font-normal ${r.caption.length >= CAPTION_MAX ? 'text-rose-600' : 'text-slate-500'}`}>{r.caption.length}/{CAPTION_MAX}</span>
                    </span>
                    <textarea value={r.caption} maxLength={CAPTION_MAX} rows={3} onChange={(e) => patch(i, { caption: e.target.value })} placeholder="사진 설명 (Enter로 줄 바꿈 가능)" className={`${fieldCls} resize-none`} />
                  </label>
                </div>
              ))}
              <button type="button" onClick={() => inputRef.current?.click()} className={PANEL_BTN_SECONDARY}>+ 사진 더 고르기</button>
            </>
          )}

          {/* 자동 입력 정보 */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div><div className="text-[10px] font-bold text-slate-600">기자 (자동)</div><div className="font-semibold text-slate-900">{currentUser.name}</div></div>
            <div className="min-w-0"><div className="text-[10px] font-bold text-slate-600">이메일 (자동)</div><div className="font-semibold text-slate-900 break-all">{currentUser.email}</div></div>
            <div><div className="text-[10px] font-bold text-slate-600">부서 (자동)</div><div className="font-semibold text-slate-900">{currentUser.department}</div></div>
          </div>

          <p className="text-[11px] text-slate-600">
            {inEditor
              ? '이 기사에서 쓰는 사진으로 올라가며, 기사 공개 범위를 따릅니다.'
              : '올린 사진은 모든 직원이 라이브러리에서 볼 수 있습니다.'}
          </p>

          {offerInsert && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={insertNow} onChange={(e) => setInsertNow(e.target.checked)} className="w-3.5 h-3.5" />
              <span className="font-semibold text-slate-700">올린 뒤 기사에 바로 넣기 (캡션·기자 이름 자동)</span>
            </label>
          )}

          {err && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={PANEL_BTN_SECONDARY}>취소</button>
          <button type="button" disabled={busy || rows.length === 0} onClick={submit} className={PANEL_BTN_PRIMARY}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {busy ? '올리는 중...' : `${rows.length || ''}개 올리기`}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 자세히 보기·고치기                                                  */
/* ------------------------------------------------------------------ */

const DetailDialog: React.FC<{
  item: MediaItem;
  currentUser: User;
  canInsert: boolean;
  isReadOnly: boolean;
  onClose: () => void;
  onInsert: (item: MediaItem) => void;
  onChanged: () => void | Promise<void>;
  showToast: (m: string) => void;
}> = ({ item, currentUser, canInsert, isReadOnly, onClose, onInsert, onChanged, showToast }) => {
  const canEdit = !isReadOnly && (item.uploadedBy === currentUser.id || isDeskUser(currentUser));
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption || '');
  const [credit, setCredit] = useState(item.credit || '');
  const [usages, setUsages] = useState<MediaArticleUsage[]>([]);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (item.storagePath) {
      mediaService.getMediaArticleUsages(item.storagePath).then(u => { if (alive) setUsages(u); });
    }
    return () => { alive = false; };
  }, [item.storagePath]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await mediaService.updateMedia(item.id, { title, caption, credit });
      showToast('미디어 정보를 저장했습니다.');
      await onChanged();
      onClose();
    } catch (e: any) {
      setMsg(e?.message || '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('이 미디어를 삭제할까요? 기사에 쓰이고 있으면 삭제되지 않습니다.')) return;
    setBusy(true);
    setMsg(null);
    try {
      await mediaService.deleteMedia(item);
      showToast('미디어를 삭제했습니다.');
      await onChanged();
      onClose();
    } catch (e: any) {
      setMsg(e?.message || '삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setMsg(null);
    try {
      const updated = await mediaService.analyzeMediaImage(item.id, true);
      if (updated.aiCaption) setCaption(c => c || updated.aiCaption!.slice(0, CAPTION_MAX));
      setMsg('AI가 사진을 분석했어요. 아래 제안 캡션을 확인해 보세요.');
      await onChanged();
    } catch (e: any) {
      setMsg(e?.message || 'AI 분석에 실패했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="text-sm font-bold text-slate-900 truncate">{item.title}</div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center min-h-40">
              {item.type === 'image' && item.url ? (
                <img src={item.url} alt={item.title} className="w-full h-auto max-h-80 object-contain" />
              ) : item.type === 'video' && item.url ? (
                <video src={item.url} controls className="w-full max-h-80" />
              ) : (
                <ImageIcon className="w-8 h-8 text-slate-400" />
              )}
            </div>
            <div className="text-[11px] text-slate-700 space-y-0.5">
              <div>올린 사람: <b>{item.uploaderName || '-'}</b> · {item.uploaderEmail || '-'} · {item.uploaderDepartment || '-'}</div>
              <div>올린 때: {item.uploadedAt} · {item.resolution} · {item.fileSize}</div>
            </div>
            <div>
              <div className="font-bold text-slate-700 mb-1">이 사진이 쓰인 기사 ({usages.length})</div>
              {usages.length === 0 ? (
                <p className="text-[11px] text-slate-600">아직 쓰인 기사가 없습니다. (삭제 가능)</p>
              ) : (
                <ul className="space-y-1">
                  {usages.map(u => (
                    <li key={u.articleId} className="flex items-center gap-1.5 text-[11px] text-slate-800">
                      <ExternalLink className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="truncate">{u.articleTitle || '(제목 없음)'}</span>
                      <span className="text-slate-500 shrink-0">· {u.projectName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="font-semibold text-slate-700">제목</span>
              <input value={title} disabled={!canEdit} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700 flex justify-between">
                <span>캡션</span>
                <span className={`font-normal ${caption.length >= CAPTION_MAX ? 'text-rose-600' : 'text-slate-500'}`}>{caption.length}/{CAPTION_MAX}</span>
              </span>
              <textarea value={caption} disabled={!canEdit} maxLength={CAPTION_MAX} rows={4} onChange={(e) => setCaption(e.target.value)} className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
            </label>
            {item.captionSuggestion && canEdit && (
              <button type="button" onClick={() => setCaption(item.captionSuggestion!.replace(/^▲\s*/, '').slice(0, CAPTION_MAX))} className="w-full text-left p-2 rounded bg-purple-50 border border-purple-200 text-[11px] text-purple-900 hover:bg-purple-100 cursor-pointer">
                <b>AI 제안 캡션 쓰기:</b> {item.captionSuggestion}
              </button>
            )}
            <label className="block">
              <span className="font-semibold text-slate-700">바이라인 (사진 출처)</span>
              <input value={credit} disabled={!canEdit} maxLength={60} onChange={(e) => setCredit(e.target.value)} className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </label>
            {!canEdit && <p className="text-[11px] text-slate-600">올린 기자와 데스크만 고칠 수 있습니다.</p>}
            {msg && <p className="text-[11px] text-slate-800 bg-slate-50 border border-slate-200 rounded p-2">{msg}</p>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 sticky bottom-0 bg-white">
          <div className="flex items-center gap-2">
            {canEdit && (
              <button type="button" disabled={busy} onClick={remove} className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> 삭제
              </button>
            )}
            {canEdit && item.type === 'image' && (
              <button type="button" disabled={analyzing || busy} onClick={analyze} className={PANEL_BTN_SECONDARY}>
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI 분석
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button type="button" disabled={busy} onClick={save} className={PANEL_BTN_SECONDARY}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 저장
              </button>
            )}
            {canInsert && (
              <button type="button" onClick={() => onInsert({ ...item, title, caption, credit })} className={PANEL_BTN_PRIMARY}>
                기사에 넣기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 편집기 아래쪽에 붙는 미디어 라이브러리 창
 * - 본문이 가려지지 않게 아래쪽에 두고, 줄을 끌어서 본문에 놓을 수 있습니다.
 */
export const MediaDock: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      id="media-library-dock"
      className={`fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-300 shadow-2xl flex flex-col ${expanded ? 'h-[75vh]' : 'h-[42vh]'}`}
    >
      <div className="flex items-center justify-between px-4 py-1.5 bg-white border-b border-slate-200 text-slate-600 text-[11px] shrink-0 select-none">
        <span className="font-semibold">미디어 라이브러리 · 줄을 끌어서 본문에 놓으면 기사에 들어갑니다</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setExpanded(v => !v)} className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-700 cursor-pointer">
            {expanded ? '▼ 작게' : '▲ 크게'}
          </button>
          <button type="button" onClick={onClose} className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-500 cursor-pointer" title="닫기">✕</button>
        </div>
      </div>
      {children}
    </div>
  );
};
