import React, { useState, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  AlertTriangle,
  Plus,
  RefreshCw
} from 'lucide-react';

interface TxtImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmImport: (paragraphs: string[], mode: 'append' | 'replace') => Promise<void>;
  currentBlockCount: number;
}

export const TxtImportModal: React.FC<TxtImportModalProps> = ({
  isOpen,
  onClose,
  onConfirmImport,
  currentBlockCount,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedParagraphs, setParsedParagraphs] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // 문단 분리 로직 (빈 줄 기준, 연속된 빈 줄 하나로 취급, 공백 문단 제외)
  const parseTxtContent = (content: string): string[] => {
    // 윈도우(\r\n) 및 유닉스(\n) 개행 정규화
    const normalized = content.replace(/\r\n/g, '\n');
    
    // 2개 이상의 연속된 개행(즉 빈 줄)을 기준으로 문단 분리
    const rawParagraphs = normalized.split(/\n\s*\n+/);

    // 각 문단의 앞뒤 공백 제거 후 빈 문단 필터링
    return rawParagraphs
      .map(p => p.trim())
      .filter(p => p.length > 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // .txt 확장자 검증
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setErrorMessage('TXT 파일(.txt)만 가져올 수 있습니다. (PDF, 워드, 오디오 파일 지원 제외)');
      setSelectedFile(null);
      setParsedParagraphs([]);
      return;
    }

    setIsLoading(true);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || text.trim().length === 0) {
          setErrorMessage('파일 내용이 비어있습니다. 내용이 포함된 TXT 파일을 선택해주세요.');
          setParsedParagraphs([]);
          setIsLoading(false);
          return;
        }

        const paragraphs = parseTxtContent(text);

        if (paragraphs.length === 0) {
          setErrorMessage('공백을 제외하고 추출된 문단이 없습니다.');
          setParsedParagraphs([]);
          setIsLoading(false);
          return;
        }

        // 최대 500 문단 제한 사전 검증
        if (paragraphs.length > 500) {
          setErrorMessage(`선택한 파일의 문단 수가 500개를 초과했습니다 (총 ${paragraphs.length}개). 500문단 이하로 분할해주세요.`);
          setParsedParagraphs([]);
          setIsLoading(false);
          return;
        }

        setParsedParagraphs(paragraphs);
      } catch (err: any) {
        console.error('File read error:', err);
        setErrorMessage('파일을 읽는 도중 오류가 발생했습니다. UTF-8 인코딩 파일인지 확인해주세요.');
        setParsedParagraphs([]);
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      setErrorMessage('파일을 열지 못했습니다. 파일 상태를 확인해주세요.');
      setIsLoading(false);
    };

    reader.readAsText(file, 'UTF-8');
  };

  const handleSubmit = async () => {
    if (parsedParagraphs.length === 0) {
      setErrorMessage('가져올 문단이 없습니다. 먼저 TXT 파일을 선택해주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirmImport(parsedParagraphs, importMode);
      onClose();
    } catch (err: any) {
      console.error('Import error:', err);
      setErrorMessage(err.message || '기사 가져오기에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedParagraphs([]);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-xl border border-slate-300 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div 
          style={{ background: 'var(--grad-topbar)' }}
          className="p-4 text-white flex items-center justify-between border-b border-slate-800"
        >
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-300" />
            <h3 className="text-sm font-bold">TXT 기사 가져오기 (Import)</h3>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-xs flex items-center space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* File Picker */}
          {!selectedFile ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50 hover:bg-blue-50/40 rounded-lg p-8 text-center cursor-pointer transition-colors group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-blue-600 mx-auto mb-2 transition-colors" />
              <p className="text-sm font-bold text-slate-800">
                TXT 파일을 선택하거나 드래그하세요
              </p>
              <p className="text-xs text-slate-500 mt-1">
                .txt 텍스트 파일만 지원 (UTF-8 인코딩, 빈 줄 기준 문단 자동 분리)
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected File Info */}
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="w-8 h-8 rounded bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate" title={selectedFile.name}>
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      용량 {(selectedFile.size / 1024).toFixed(1)} KB · 인식된 문단 <span className="font-bold text-blue-600">{parsedParagraphs.length}개</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isSubmitting}
                  className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  다른 파일 선택
                </button>
              </div>

              {/* Import Mode Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  가져오기 방식 선택 <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label 
                    className={`flex items-start space-x-2.5 p-3 rounded-md border cursor-pointer transition-all ${
                      importMode === 'append'
                        ? 'bg-blue-50/70 border-blue-500 ring-1 ring-blue-500 text-blue-900'
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-xs flex items-center space-x-1">
                        <Plus className="w-3.5 h-3.5 text-blue-600" />
                        <span>현재 본문 뒤에 추가 (권장)</span>
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        기존 {currentBlockCount}개 문단을 유지하고 뒤에 추가합니다.
                      </p>
                    </div>
                  </label>

                  <label 
                    className={`flex items-start space-x-2.5 p-3 rounded-md border cursor-pointer transition-all ${
                      importMode === 'replace'
                        ? 'bg-rose-50/70 border-rose-500 ring-1 ring-rose-500 text-rose-900'
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-xs flex items-center space-x-1">
                        <RefreshCw className="w-3.5 h-3.5 text-rose-600" />
                        <span>현재 본문 교체</span>
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        기존 문단을 모두 지우고 새 문단으로 교체합니다.
                      </p>
                    </div>
                  </label>
                </div>

                {importMode === 'replace' && (
                  <div className="mt-2.5 p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded text-xs flex items-center space-x-2 animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>주의: 현재 작성 중인 기존 본문 문단이 가져온 TXT 내용으로 완전히 교체됩니다.</span>
                  </div>
                )}
              </div>

              {/* Preview Box */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-slate-800 text-xs">
                    문단 미리보기 (총 {parsedParagraphs.length}개 중 앞부분)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    빈 줄 기준으로 분리됨
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2.5 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-700 leading-relaxed">
                  {parsedParagraphs.slice(0, 3).map((para, idx) => (
                    <div key={idx} className="pb-2 border-b border-slate-200 last:border-b-0 last:pb-0">
                      <span className="inline-block px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 text-[10px] font-bold mr-1.5">
                        § {idx + 1}
                      </span>
                      <span className="whitespace-pre-wrap">{para}</span>
                    </div>
                  ))}
                  {parsedParagraphs.length > 3 && (
                    <div className="text-center text-slate-400 text-[11px] pt-1 italic">
                      ... 외 {parsedParagraphs.length - 3}개 문단 생략 ...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-md text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            id="btn-confirm-txt-import"
            onClick={handleSubmit}
            disabled={!selectedFile || parsedParagraphs.length === 0 || isSubmitting || isLoading}
            style={{ background: 'var(--grad-button)' }}
            className="px-4 py-2 text-white rounded-md text-xs font-bold inline-flex items-center space-x-1.5 shadow-2xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>문단 저장 중...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{parsedParagraphs.length}개 문단 가져오기</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
