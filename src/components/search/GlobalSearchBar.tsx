import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  FileText,
  FolderKanban,
  Loader2,
  ExternalLink,
  CornerDownLeft,
  Command
} from 'lucide-react';
import { GlobalSearchResult, SearchResultArticle, SearchResultProject } from '../../types';
import { searchService } from '../../services/searchService';
import { ArticleStatusBadge } from '../common/ArticleStatusBadge';

interface GlobalSearchBarProps {
  onSelectArticle: (articleId: string, projectId: string) => void;
  onSelectProject: (projectId: string) => void;
}

/**
 * 안전한 텍스트 하이라이트 컴포넌트 (dangerouslySetInnerHTML 미사용)
 */
const HighlightedText: React.FC<{ text: string; query: string; className?: string }> = ({
  text,
  query,
  className = '',
}) => {
  if (!query || query.trim().length === 0) {
    return <span className={className}>{text}</span>;
  }

  const cleanQuery = query.trim().replace(/[%_,()'"\\]/g, '');
  if (!cleanQuery) return <span className={className}>{text}</span>;

  // 특수문자 이스케이프 후 대소문자 무시 분할
  const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-amber-200/90 text-slate-900 rounded-2xs px-0.5 font-bold"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
};

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  onSelectArticle,
  onSelectProject,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult>({
    articles: [],
    projects: [],
    totalCount: 0,
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [searchError, setSearchError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 플랫한 네비게이션 아이템 목록 생성 (키보드 상/하 이동용)
  const flattenedItems = useMemo(() => {
    const list: Array<
      | { type: 'article'; data: SearchResultArticle }
      | { type: 'project'; data: SearchResultProject }
    > = [];
    results.articles.forEach(a => list.push({ type: 'article', data: a }));
    results.projects.forEach(p => list.push({ type: 'project', data: p }));
    return list;
  }, [results]);

  // Ctrl+K / Cmd+K 글로벌 단축키 바인딩
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 외부 클릭 시 패널 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // 검색어 입력 시 300ms Debounce 적용
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ articles: [], projects: [], totalCount: 0 });
      setIsLoading(false);
      setSearchError(null);
      setSelectedIndex(-1);
      return;
    }

    setIsLoading(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await searchService.search(trimmed);
        setResults(res);
        setSelectedIndex(-1);
      } catch (err: any) {
        console.error('[GlobalSearchBar] Search error:', err);
        setSearchError('검색 중 문제가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // 키보드 조작 핸들러 (ArrowDown, ArrowUp, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (flattenedItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < flattenedItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : flattenedItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < flattenedItems.length) {
        handleSelectItem(flattenedItems[selectedIndex]);
      } else if (flattenedItems.length > 0) {
        handleSelectItem(flattenedItems[0]);
      }
    }
  };

  const handleSelectItem = (
    item:
      | { type: 'article'; data: SearchResultArticle }
      | { type: 'project'; data: SearchResultProject }
  ) => {
    setIsOpen(false);
    setQuery('');
    if (item.type === 'article') {
      onSelectArticle(item.data.id, item.data.projectId);
    } else {
      onSelectProject(item.data.id);
    }
  };

  return (
    <div className="relative flex-1 max-w-md mx-2 sm:mx-4" ref={containerRef}>
      {/* 1. 검색 입력 인풋 바 */}
      <div
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/25 hover:bg-black/35 border text-xs text-white/90 transition-all cursor-text shadow-2xs ${
          isOpen
            ? 'border-blue-400 bg-black/40 ring-1 ring-blue-400/50'
            : 'border-white/15'
        }`}
      >
        <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="기사 제목, 부제, 프로젝트 검색..."
          className="bg-transparent w-full text-xs text-white placeholder-white/45 focus:outline-none"
        />

        {query && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setQuery('');
              setResults({ articles: [], projects: [], totalCount: 0 });
              inputRef.current?.focus();
            }}
            className="text-white/40 hover:text-white p-0.5 cursor-pointer shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <div className="hidden sm:flex items-center space-x-0.5 text-[12px] text-white/40 bg-white/10 px-1.5 py-0.5 rounded border border-white/10 shrink-0 select-none">
          <Command className="w-2.5 h-2.5" />
          <span>K</span>
        </div>
      </div>

      {/* 2. 검색 결과 드롭다운 패널 */}
      {isOpen && (
        <div
          id="panel-global-search-results"
          className="absolute left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-900 animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header 상태 바 */}
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[12px] text-slate-500 select-none">
            <span>
              {query.trim().length < 2
                ? '2글자 이상 입력해주세요'
                : isLoading
                ? '검색 중...'
                : `검색 결과 ${results.totalCount}건`}
            </span>
            <div className="flex items-center space-x-2 text-[12px] text-slate-400">
              <span className="flex items-center space-x-0.5">
                <span>↑↓ 이동</span>
              </span>
              <span>·</span>
              <span className="flex items-center space-x-0.5">
                <CornerDownLeft className="w-2.5 h-2.5" />
                <span>선택</span>
              </span>
              <span>·</span>
              <span>Esc 닫기</span>
            </div>
          </div>

          {/* List Content */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-8 text-center flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
                <span className="text-xs">데이터베이스에서 일치 항목을 검색하고 있습니다...</span>
              </div>
            ) : searchError ? (
              <div className="p-6 text-center text-xs text-rose-500">{searchError}</div>
            ) : query.trim().length < 2 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                <p className="font-semibold text-slate-600">뉴스룸 통합 검색</p>
                <p className="text-[12px] mt-1 text-slate-400">
                  기사 제목, 부제, 카테고리 또는 프로젝트명을 입력하세요.
                </p>
              </div>
            ) : results.totalCount === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                <p className="font-bold text-slate-700">검색 결과가 없습니다.</p>
                <p className="text-[12px] mt-1 text-slate-400">
                  입력하신 검색어와 일치하는 기사나 프로젝트를 찾을 수 없습니다.
                </p>
              </div>
            ) : (
              <div>
                {/* 1) 기사 검색 결과 */}
                {results.articles.length > 0 && (
                  <div>
                    <div className="px-3.5 py-1.5 bg-slate-100/70 text-[12px] font-bold text-slate-600 flex items-center justify-between select-none">
                      <span className="flex items-center space-x-1.5">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        <span>기사 ({results.articles.length})</span>
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {results.articles.map((art) => {
                        const globalIdx = flattenedItems.findIndex(
                          it => it.type === 'article' && it.data.id === art.id
                        );
                        const isFocused = globalIdx === selectedIndex;

                        return (
                          <div
                            key={`art-${art.id}`}
                            onClick={() => handleSelectItem({ type: 'article', data: art })}
                            className={`p-3 transition-colors cursor-pointer flex items-start justify-between gap-2 group ${
                              isFocused ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1 flex-wrap gap-y-0.5">
                                <ArticleStatusBadge status={art.status} size="sm" />
                                <span className="text-[12px] font-semibold text-slate-500 truncate max-w-[140px]">
                                  {art.projectName}
                                </span>
                                {art.category && (
                                  <span className="text-[12px] text-slate-600 bg-slate-100 px-1 py-0.2 rounded">
                                    {art.category}
                                  </span>
                                )}
                                <span className="text-[12px] text-slate-400">
                                  {art.updatedAtFormatted}
                                </span>
                              </div>
                              <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                                <HighlightedText text={art.title} query={query} />
                              </h4>
                              {art.subtitle && (
                                <p className="text-[12px] text-slate-500 line-clamp-1 mt-0.5">
                                  <HighlightedText text={art.subtitle} query={query} />
                                </p>
                              )}
                              {art.authorName && (
                                <p className="text-[12px] text-slate-400 mt-1">
                                  작성자: {art.authorName} ({art.authorDepartment || '보도국'})
                                </p>
                              )}
                            </div>
                            <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 shrink-0">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 2) 프로젝트 검색 결과 */}
                {results.projects.length > 0 && (
                  <div>
                    <div className="px-3.5 py-1.5 bg-slate-100/70 text-[12px] font-bold text-slate-600 flex items-center justify-between select-none">
                      <span className="flex items-center space-x-1.5">
                        <FolderKanban className="w-3.5 h-3.5 text-indigo-600" />
                        <span>프로젝트 ({results.projects.length})</span>
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {results.projects.map((proj) => {
                        const globalIdx = flattenedItems.findIndex(
                          it => it.type === 'project' && it.data.id === proj.id
                        );
                        const isFocused = globalIdx === selectedIndex;

                        return (
                          <div
                            key={`proj-${proj.id}`}
                            onClick={() => handleSelectItem({ type: 'project', data: proj })}
                            className={`p-3 transition-colors cursor-pointer flex items-start justify-between gap-2 group ${
                              isFocused ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <span className={`text-[12px] px-1.5 py-0.2 rounded font-semibold border ${
                                  proj.visibility === 'shared'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                }`}>
                                  {proj.visibility === 'shared' ? '전체공유' : '비공개'}
                                </span>
                                <span className="text-[12px] text-slate-400">
                                  {proj.updatedAtFormatted}
                                </span>
                              </div>
                              <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                                <HighlightedText text={proj.name} query={query} />
                              </h4>
                              {proj.articleTitle && (
                                <p className="text-[12px] text-slate-500 line-clamp-1 mt-0.5">
                                  기사: <HighlightedText text={proj.articleTitle} query={query} />
                                </p>
                              )}
                              {proj.ownerName && (
                                <p className="text-[12px] text-slate-400 mt-1">
                                  생성자: {proj.ownerName} ({proj.ownerDepartment || '보도국'})
                                </p>
                              )}
                            </div>
                            <span className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 shrink-0">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer 안내 */}
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-center select-none">
            <span className="text-[12px] text-slate-400">
              클릭하거나 Enter를 누르면 해당 기사 편집기 또는 프로젝트로 즉시 이동합니다
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
