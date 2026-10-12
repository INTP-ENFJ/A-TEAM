import React, { useState } from 'react';
import {
  BookOpen,
  FileEdit,
  Sparkles,
  Send,
  KeyRound,
  LayoutDashboard,
  HelpCircle,
  ArrowRight,
  ShieldCheck,
  Clock,
  Users,
  Building2,
  PhoneCall,
  UserCheck,
  AlertCircle,
  Mic,
  Image as ImageIcon,
  MessageSquare,
  History,
  Lightbulb,
  ListChecks,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';

interface UserGuideViewProps {
  onNavigate: (screen: 'dashboard' | 'editor' | 'preview' | 'settings' | 'hr' | 'guide') => void;
}

/* ---------- 읽기 쉬운 안내서용 작은 부품들 ---------- */

/** 화면의 버튼 이름을 눈에 띄게 보여 주는 표시 */
const B: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-block px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800 border border-slate-600 text-white text-[12px] font-bold whitespace-nowrap">
    {children}
  </span>
);

/** 번호가 붙은 순서 안내 */
const Steps: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ol className="space-y-2.5">
    {items.map((it, i) => (
      <li key={i} className="flex items-start gap-3">
        <span className="mt-0.5 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {i + 1}
        </span>
        <div className="flex-1 text-[14px] leading-7 text-slate-200">{it}</div>
      </li>
    ))}
  </ol>
);

/** 점으로 나열하는 목록 */
const Bullets: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="space-y-1.5">
    {items.map((it, i) => (
      <li key={i} className="flex items-start gap-2 text-[14px] leading-7 text-slate-200">
        <ChevronRight className="w-4 h-4 mt-1.5 text-slate-500 shrink-0" />
        <div className="flex-1">{it}</div>
      </li>
    ))}
  </ul>
);

/** 알아두기(파랑) / 주의(노랑) 상자 */
const Note: React.FC<{ kind?: 'tip' | 'warn'; title?: string; children: React.ReactNode }> = ({ kind = 'tip', title, children }) => (
  <div
    className={`rounded-lg border p-3.5 text-[13px] leading-7 ${
      kind === 'warn'
        ? 'bg-amber-950/40 border-amber-700/60 text-amber-100'
        : 'bg-blue-950/40 border-blue-800/60 text-blue-100'
    }`}
  >
    <div className="flex items-center gap-1.5 font-bold mb-0.5">
      {kind === 'warn' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Lightbulb className="w-4 h-4 shrink-0" />}
      <span>{title || (kind === 'warn' ? '주의하세요' : '알아두면 좋아요')}</span>
    </div>
    <div>{children}</div>
  </div>
);

/** 한 가지 주제를 담는 큰 카드 */
const Section: React.FC<{
  id: string;
  no: number;
  icon: React.ReactNode;
  title: string;
  summary: string;
  children: React.ReactNode;
}> = ({ id, no, icon, title, summary, children }) => (
  <section id={id} className="scroll-mt-4 bg-slate-950 rounded-2xl border border-slate-800 p-5 sm:p-6 space-y-4">
    <header className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-700 text-blue-300 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-bold text-slate-500 tracking-wide">STEP {no}</div>
        <h3 className="text-base sm:text-lg font-extrabold text-white leading-snug">{title}</h3>
        <p className="text-[13px] text-slate-400 mt-0.5">{summary}</p>
      </div>
    </header>
    <div className="space-y-4">{children}</div>
  </section>
);

/** 작은 소제목 */
const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[13px] font-bold text-blue-300 pt-1">{children}</h4>
);

/** 왼쪽 목차 + 본문 레이아웃 */
const GuideLayout: React.FC<{ toc: { id: string; label: string }[]; children: React.ReactNode }> = ({ toc, children }) => {
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
      <nav className="lg:sticky lg:top-2 bg-slate-950 rounded-2xl border border-slate-800 p-3 space-y-1">
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-slate-400">
          <ListChecks className="w-4 h-4" />
          <span>목차 (누르면 이동)</span>
        </div>
        <div className="flex flex-wrap lg:flex-col gap-1">
          {toc.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              className="text-left px-2.5 py-1.5 rounded-lg text-[13px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            >
              <span className="text-slate-500 font-bold mr-1.5">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="space-y-5 min-w-0">{children}</div>
    </div>
  );
};

/** 업무 흐름을 한 줄로 보여 주는 띠 */
const FlowStrip: React.FC<{ steps: string[] }> = ({ steps }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {steps.map((s, i) => (
      <React.Fragment key={s}>
        <span className="px-3 py-1.5 rounded-full bg-slate-900 border border-slate-700 text-[13px] font-bold text-white">{s}</span>
        {i < steps.length - 1 && <ArrowRight className="w-4 h-4 text-slate-500" />}
      </React.Fragment>
    ))}
  </div>
);

const REPORTER_TOC = [
  { id: 'rp-start', label: '시작하기와 알림' },
  { id: 'rp-write', label: '기사 쓰기' },
  { id: 'rp-media', label: '사진·영상 넣기' },
  { id: 'rp-ai', label: 'AI로 초안 만들기' },
  { id: 'rp-stt', label: '녹음 받아쓰기' },
  { id: 'rp-review', label: 'AI 검수와 인포그래픽' },
  { id: 'rp-flow', label: '검토·피드백·출고' },
  { id: 'rp-account', label: '계정과 비밀번호' },
  { id: 'rp-faq', label: '자주 묻는 질문' },
];

const HR_TOC = [
  { id: 'hr-staff', label: '직원 명부·수정·비활성화' },
  { id: 'hr-signup', label: '가입 승인' },
  { id: 'hr-reset', label: '비밀번호 분실 신고' },
  { id: 'hr-master', label: '부서·직책 관리' },
  { id: 'hr-audit', label: '인사·권한 변경 기록' },
  { id: 'hr-rules', label: '권한 규칙과 보안 수칙' },
];

export const UserGuideView: React.FC<UserGuideViewProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'reporter' | 'hr' | 'api'>('reporter');

  const tabClass = (on: boolean, color: string) =>
    `flex items-center space-x-2 px-4 py-2.5 rounded-lg text-[13px] font-bold transition-all cursor-pointer ${
      on ? `${color} text-white shadow-md` : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 text-slate-100 p-3 sm:p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto space-y-6 break-keep">
        {/* 1. 상단 타이틀 배너 */}
        <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-slate-950 p-5 sm:p-7 rounded-2xl border border-blue-900/50 shadow-xl space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-900/60 border border-blue-700/80 text-blue-300 text-xs font-bold">
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>처음 사용하는 분을 위한 친절한 안내서</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">PRESS-CMS 사용법 한눈에 보기</h1>
          <p className="text-sm sm:text-[15px] text-slate-300 leading-7 max-w-3xl">
            어려운 말 없이, 꼭 필요한 기능을 쓰는 순서대로 정리했습니다. 아래에서 내게 맞는 안내서를 고르고, 왼쪽 목차를 눌러 필요한 곳으로 바로 이동하세요.
          </p>

          <div className="pt-2 flex flex-wrap gap-2">
            <button type="button" id="guide-tab-reporter" onClick={() => setActiveTab('reporter')} className={tabClass(activeTab === 'reporter', 'bg-blue-600')}>
              <FileEdit className="w-4 h-4 shrink-0" />
              <span>기자용 (기사 작성 &amp; 출고)</span>
            </button>
            <button type="button" id="guide-tab-hr" onClick={() => setActiveTab('hr')} className={tabClass(activeTab === 'hr', 'bg-purple-600')}>
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>인사 관리자용 (직원 &amp; 승인)</span>
            </button>
            <button type="button" id="guide-tab-api" onClick={() => setActiveTab('api')} className={tabClass(activeTab === 'api', 'bg-emerald-600')}>
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>AI 키 등록 &amp; 요금</span>
            </button>
          </div>
        </div>

        {/* 2. 기자용 안내서 */}
        {activeTab === 'reporter' && (
          <GuideLayout toc={REPORTER_TOC}>
            <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2 text-white font-extrabold text-base">
                <HelpCircle className="w-5 h-5 text-blue-400" />
                <span>5분 요약 — 기사 한 편의 길</span>
              </div>
              <FlowStrip steps={['새 기사 쓰기', 'AI 도움 받기', '검토 요청', '데스크 승인', '출고']} />
              <p className="text-[13px] text-slate-400 leading-7">
                AI는 <strong className="text-slate-200">초안을 돕는 도구</strong>일 뿐, 사실 확인과 최종 판단은 기자의 몫입니다. 중간에 데스크가 수정을 요청하면 고쳐서 다시 검토를 요청하면 됩니다.
              </p>
            </div>

            <Section id="rp-start" no={1} icon={<LayoutDashboard className="w-5 h-5" />} title="시작하기와 알림" summary="대시보드에서 새 기사를 만들고, 🔔 알림으로 업무 소식을 받습니다.">
              <Steps
                items={[
                  <>왼쪽 메뉴 <B>Dashboard</B>에서 <B>+ 새 기사 작성</B>을 누릅니다.</>,
                  <>제목을 정하면 바로 글을 쓸 수 있는 편집 화면이 열립니다.</>,
                  <>공개 범위를 고릅니다: <strong>비공개</strong>(나만) · <strong>같은 부서 공개</strong> · <strong>전체 공개</strong>. 단, 출고 대기 상태가 되면 공개 범위와 상관없이 같은 부서 데스크가 검토할 수 있습니다.</>,
                ]}
              />
              <Sub>🔔 알림센터 (화면 맨 위 종 모양)</Sub>
              <Bullets
                items={[
                  <>다음 소식이 오면 종에 빨간 숫자가 뜹니다: 검토 요청 · 수정 요청 · 재검토 요청 · 승인 · 출고 · 기사 배정 · 마감 변경 · <strong>새 피드백</strong>. (인사 담당자가 내 직책 등을 바꾸면 <strong>인사 정보 변경</strong> 알림도 옵니다.)</>,
                  <>알림을 누르면 <strong>해당 기사로 바로 이동</strong>하고, <B>모두 읽음</B>으로 한 번에 읽음 처리할 수 있습니다.</>,
                  <>새 알림은 화면을 새로고침하지 않아도 바로 나타납니다.</>,
                ]}
              />
            </Section>

            <Section id="rp-write" no={2} icon={<FileEdit className="w-5 h-5" />} title="기사 쓰기" summary="워드·한글처럼 한 장의 문서에 이어서 씁니다.">
              <Bullets
                items={[
                  <>제목·부제목·분류·해시태그를 정하고, 아래 본문에 이어서 씁니다. 엔터로 문단을 나누고 어디든 눌러서 바로 고칠 수 있습니다.</>,
                  <><strong>자동 저장</strong>: 글을 쓰면 1초쯤 뒤 저절로 저장됩니다. 저장이 실패하면 5초 뒤 다시 시도하니 저장 버튼을 깜빡해도 괜찮습니다.</>,
                  <>왼쪽 아래 <strong>기사 원고 분량</strong>에서 글자 수·공백 포함 수·문단 수를 볼 수 있습니다.</>,
                  <><B>TXT 가져오기</B> 메모장 글을 문단별로 본문에 넣습니다.</>,
                  <>상단 <B>내보내기</B> 워드 문서(.docx, 사진 포함) 또는 텍스트(.txt)로 저장합니다. 자른 사진 모양도 그대로 들어갑니다.</>,
                  <>왼쪽 메뉴 <B>History</B> 지금까지 저장된 판본이 시간순으로 있어, 실수로 지운 글도 이전 버전으로 되돌릴 수 있습니다.</>,
                ]}
              />
            </Section>

            <Section id="rp-media" no={3} icon={<ImageIcon className="w-5 h-5" />} title="사진·영상 넣기" summary="끌어다 놓기만 하면 캡션과 기자 이름이 자동으로 붙습니다.">
              <Steps
                items={[
                  <>편집 화면 위 <B>AI 도구</B>를 누르고 오른쪽 <B>미디어</B> 탭을 엽니다. 사진 목록이 나옵니다. (제목·캡션·기자·부서로 검색, 범위와 기간으로 좁히기 가능)</>,
                  <>사진을 <strong>본문 원하는 자리로 끌어다 놓거나</strong> <B>기사에 넣기</B>를 누릅니다. 컴퓨터의 이미지 파일을 본문에 바로 끌어다 놓아도 됩니다.</>,
                  <>본문 속 사진은 그대로 끌면 옮겨집니다. 놓을 수 있는 자리는 점선과 파란 선으로 보이고, 화면 위·아래 끝으로 끌면 자동으로 스크롤됩니다.</>,
                ]}
              />
              <Sub>사진 다듬기 (사진에 마우스를 올리면 버튼이 나타납니다)</Sub>
              <Bullets
                items={[
                  <><B>자르기·확대</B> 사진을 끌어 보이는 부분을 맞추고 <strong>확대</strong> 막대로 크기를 정한 뒤 <B>완료</B>. <B>가운데로</B>는 처음 위치, <B>자르기 해제</B>는 원본 전체로 되돌립니다.</>,
                  <><B>일부 가리기</B> 얼굴·차량 번호 등을 끌어서 네모로 표시하고 <strong>흐리게/모자이크</strong>와 정도를 골라 <B>적용</B>합니다.</>,
                  <>캡션과 크레딧(촬영자)은 사진 아래 칸에서 직접 고칠 수 있습니다.</>,
                ]}
              />
              <Sub>사진 올리기와 AI 이미지</Sub>
              <Bullets
                items={[
                  <>왼쪽 메뉴 <B>Media</B>에서는 같은 사진을 크게 관리하고 <B>사진 올리기</B>로 여러 장을 한꺼번에 올립니다. 이름·이메일·부서는 자동으로 들어갑니다.</>,
                  <><B>AI 이미지</B> 설명글을 쓰면 AI가 그림을 만들어 줍니다. 마음에 들면 라이브러리에 올릴 수 있고, 출처가 &quot;AI 생성(모델명)&quot;으로, 캡션에 <strong>[AI 생성 이미지]</strong>가 자동 표기됩니다. (Gemini 또는 OpenAI 키가 필요합니다)</>,
                ]}
              />
            </Section>

            <Section id="rp-ai" no={4} icon={<Sparkles className="w-5 h-5" />} title="AI로 초안 만들기" summary="AI가 질문하고 내가 답한 사실만으로 초안을 만듭니다. 없는 사실은 지어내지 않습니다.">
              <Steps
                items={[
                  <>편집 화면 위 <B>AI 도구</B> → 위쪽 탭에서 <B>AI 초안</B>을 고릅니다. (좁은 화면에서는 창 위쪽의 <B>대화 | 초안</B> 스위치로 오갑니다.)</>,
                  <>
                    <strong>취재 기본 정보 입력</strong> 화면에서 <strong>주제</strong>, <strong>키워드</strong>, <strong>기사 어조</strong>(스트레이트 · 해설·분석 · 인터뷰 · 피처·르포), <strong>취재 메모</strong>를 적습니다.
                  </>,
                  <>취재 메모 칸 아래 버튼으로 자료를 더할 수 있습니다 (아래 표 참고).</>,
                  <><B>취재 인터뷰 시작하기</B>를 누르면 AI가 질문합니다(누가, 언제, 어디서…). 짧게 답하세요. 부족한 사실은 주황색 <strong className="text-amber-300">[확인 필요]</strong>로 남습니다.</>,
                  <>충분히 모였으면 <B>지금까지 답변으로 기사 초안 만들기</B>를 누릅니다. 추천 제목, 리드, 본문 문단이 나옵니다.</>,
                  <>마음에 드는 문단의 <B>본문 삽입</B>을 누르거나, <B>전체 본문 일괄 추가</B>로 한 번에 넣습니다. 추천 제목도 눌러서 적용할 수 있습니다.</>,
                ]}
              />

              <div className="rounded-xl border border-slate-800 overflow-x-auto">
                <table className="w-full text-[13px] text-left">
                  <thead className="bg-slate-900 text-slate-300">
                    <tr>
                      <th className="p-3 font-bold whitespace-nowrap">자료 넣는 방법</th>
                      <th className="p-3 font-bold">어떻게 쓰나요</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300 align-top">
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">직접 붙여넣기</td><td className="p-3">보도자료 문구, 수치 메모, 관계자 발언 등을 취재 메모 칸에 붙여넣습니다.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap"><B>파일 불러오기 (TXT·CSV)</B></td><td className="p-3">txt · csv · tsv · md 파일을 읽어 옵니다. 한글 엑셀 CSV도 깨지지 않습니다.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap"><B>웹 주소에서 가져오기</B></td><td className="p-3">기사·자료 주소를 넣으면 제목과 본문을 가져오고 <strong>출처 주소와 수집일</strong>이 자동으로 적힙니다. 회사 내부 주소와 수집을 막아 둔 사이트는 가져오지 않으며, 2MB·약 3만 자까지입니다.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap"><B>녹음 받아쓰기</B></td><td className="p-3">녹음 파일을 글로 바꿔 메모에 넣습니다. 다음 4번 항목에서 자세히 설명합니다.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap"><B>AI로 정리하기</B></td><td className="p-3">길고 흩어진 메모를 5W1H·인용문·수치로 정리합니다. 원자료에 없는 발언이나 숫자는 걸러냅니다. 마음에 안 들면 <B>정리 전 원문으로 되돌리기</B>.</td></tr>
                  </tbody>
                </table>
              </div>

              <Sub>초안 다듬기</Sub>
              <Bullets
                items={[
                  <>문단마다 <B>다시 작성</B>(리드) 또는 <B>수정 요청</B>(본문)을 누르고 &quot;더 짧게&quot;, &quot;수치를 앞으로&quot; 같은 지시를 적으면 그 문단만 다시 씁니다. 전체 수정 지시를 보낼 수도 있습니다. 새 사실은 만들지 않고 수집된 사실 안에서만 고칩니다.</>,
                  <><strong>근거 표시</strong>: 초안 문장 중 <span className="px-1 rounded bg-emerald-200/20 text-emerald-200 font-bold">초록</span>은 내가 준 자료에서 찾은 문장, <span className="px-1 rounded bg-amber-300/30 text-amber-200 font-bold underline decoration-dotted">노랑</span>은 근거를 못 찾은 문장(숫자가 다른 경우 포함)입니다. 문장에 마우스를 올리면 이유가 보이고, <B>표시 끄기</B>로 숨길 수 있습니다.</>,
                ]}
              />
              <Note kind="warn" title="노랑 문장은 꼭 확인하세요">
                근거 표시는 글자를 비교한 <strong>참고용</strong>입니다. 초록이어도 사실 확인을 대신하지 못하고, 노랑이어도 틀렸다는 뜻은 아닙니다. 숫자·이름·인용문은 반드시 원자료와 대조해 주세요.
              </Note>
              <Note title="AI 초안을 쓴 기록은 남습니다">
                AI 초안을 본문에 넣으면 기사 이력에 <strong>&quot;AI 초안 반영&quot;</strong>이 자동으로 기록되고, 출고 창에도 AI 사용 안내가 뜹니다. 회사의 AI 사용 표기 기준에 맞게 표기해 주세요.
              </Note>
            </Section>

            <Section id="rp-stt" no={5} icon={<Mic className="w-5 h-5" />} title="녹음 받아쓰기 (음성 → 글)" summary="인터뷰·발표 녹음을 글로 바꿔 취재 메모나 답변으로 씁니다.">
              <Sub>버튼은 어디에 있나요?</Sub>
              <Bullets
                items={[
                  <><strong>인터뷰를 시작하기 전</strong>: <B>AI 도구</B> → <B>AI 초안</B> → 취재 메모 칸 바로 아래 <B>녹음 받아쓰기</B>.</>,
                  <><strong>인터뷰를 이미 시작한 뒤</strong>: 답변 입력칸 바로 위 <B>녹음 받아쓰기 (녹음으로 답하기)</B>. 받아쓴 글이 답변 칸에 들어가니 고친 뒤 보내세요.</>,
                  <>이 버튼이 안 보이면 오른쪽 창이 <B>AI 초안</B> 탭이고 <B>대화</B> 쪽인지 확인하세요.</>,
                ]}
              />
              <Steps
                items={[
                  <>버튼을 누르면 옵션이 펼쳐집니다. <strong>말하는 언어</strong>(한국어·영어·일본어·중국어)와 <strong>방식</strong>을 고릅니다.</>,
                  <><strong>발표·강연</strong>은 한 사람이 말하는 경우, <strong>인터뷰</strong>는 &quot;화자1:&quot;, &quot;화자2:&quot;처럼 말한 사람별로 나눠 적습니다. 인터뷰는 말하는 사람 수(2~6명)를 알려 주면 더 잘 나눕니다.</>,
                  <><strong>엔진</strong>을 고릅니다(Gemini · OpenAI · 구글 클라우드). 키가 없는 엔진에는 &quot;(키 없음)&quot;이 붙습니다. 키는 환경설정에서 먼저 등록해야 합니다.</>,
                  <><B>녹음 파일 고르고 시작</B>을 누르고 파일(mp3 · m4a · wav · aac · ogg · flac · webm)을 고릅니다. 끝나면 글이 들어갑니다.</>,
                  <>인터뷰로 받아썼다면 <strong>화자 이름 바꾸기</strong> 칸이 나옵니다. &quot;화자1&quot; 옆에 실제 이름을 적고 적용하면 메모 전체에 반영됩니다.</>,
                ]}
              />
              <Bullets
                items={[
                  <>파일 크기: Gemini·OpenAI는 <strong>10MB까지</strong>, 구글 클라우드는 <strong>30분·60MB까지</strong>입니다.</>,
                  <>어떤 엔진이 맞을지 모르겠다면 먼저 <strong>Gemini</strong>로 해 보세요.</>,
                ]}
              />
              <Note kind="warn" title="받아쓴 글은 꼭 한 번 들으며 확인하세요">
                숫자·이름·고유명사를 잘못 들을 수 있고(예: &quot;천오백 원&quot;을 &quot;1,850원&quot;으로), 화자 구분도 완벽하지 않습니다. 또 녹음은 선택한 외부 서비스(구글·OpenAI)로 전송되므로 <strong>취재원에게 녹음과 AI 처리 사실을 알리고 동의</strong>를 받아 두세요. 녹음 파일은 PRESS-CMS에 저장되지 않고 받아쓴 글만 남습니다.
              </Note>
            </Section>

            <Section id="rp-review" no={6} icon={<CheckCircle2 className="w-5 h-5" />} title="AI 검수와 인포그래픽" summary="다 쓴 글을 AI가 점검해 줍니다. 원문은 절대 마음대로 바꾸지 않습니다.">
              <Bullets
                items={[
                  <><B>AI 도구</B> → <B>AI 검수</B> 탭에서 검수를 시작합니다. 비문(주어·서술어 호응, 조사, 시제), 외래어·숫자·날짜·단위 표기, 제목과 본문이 맞는지(인물·기관·수치) 등을 봅니다.</>,
                  <>지적마다 <strong>원문 · 유형 · 이유 · 확인할 점 · 고치는 예시</strong>가 나옵니다. 고칠지는 기자가 직접 정합니다.</>,
                  <>&quot;정보 확인 필요&quot; 항목이 남아 있으면 출고 창에 주의 문구가 뜹니다.</>,
                  <><B>인포그래픽</B> 탭에서는 기사 속 수치로 간단한 그래프 이미지를 만들 수 있습니다.</>,
                ]}
              />
            </Section>

            <Section id="rp-flow" no={7} icon={<Send className="w-5 h-5" />} title="검토·피드백·출고" summary="기자는 검토를 요청하고, 데스크는 수정을 요청하거나 승인하고, 부장이 출고합니다.">
              <FlowStrip steps={['작성중', '검토중', '수정요청 / 승인', '출고 대기', '출고 완료']} />
              <div className="rounded-xl border border-slate-800 overflow-x-auto">
                <table className="w-full text-[13px] text-left">
                  <thead className="bg-slate-900 text-slate-300">
                    <tr>
                      <th className="p-3 font-bold whitespace-nowrap">누가</th>
                      <th className="p-3 font-bold">무엇을</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300 align-top">
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">기자(작성자)</td><td className="p-3">다 썼으면 상단 <B>검토 요청</B>. 수정 요청을 받았다면 고친 뒤 <B>재검토 요청</B>.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">데스크(부장·차장 등)</td><td className="p-3">같은 부서 기사를 읽고 <B>수정 요청</B>(사유 필수) 또는 <B>승인</B>. 본인이 쓴 기사는 직접 승인할 수 없습니다.</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">부장</td><td className="p-3">출고 대기 기사를 열어 <B>출고하기</B>에서 송고 채널을 확인하고 출고합니다.</td></tr>
                  </tbody>
                </table>
              </div>
              <Note>
                상단 상태 메뉴로 상태를 직접 바꿀 수도 있습니다(예: 출고 대기에서 다시 초안으로). 검토 중인 기사는 본문을 고칠 수 없지만 피드백은 남길 수 있습니다.
              </Note>

              <Sub>
                <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />피드백 남기기와 확인하기</span>
              </Sub>
              <Steps
                items={[
                  <>고치고 싶은 글을 <strong>마우스로 드래그</strong>하면 나타나는 <B>피드백 작성</B>을 누르고 메모를 적습니다. 그 글에 형광펜이 칠해집니다.</>,
                  <>오른쪽 <B>피드백</B> 탭의 메모를 누르면 <strong>본문의 그 위치로 이동</strong>합니다. 답글을 달고 해결 처리도 할 수 있습니다.</>,
                  <>본문이 조금 바뀌어도 앞뒤 글을 비교해 위치를 다시 찾습니다. 그래도 못 찾으면 &quot;원문 위치를 찾을 수 없음&quot;으로 표시됩니다.</>,
                  <>피드백이 달리면 기사 작성자에게 🔔 &quot;새 피드백&quot; 알림이 갑니다.</>,
                ]}
              />
            </Section>

            <Section id="rp-account" no={8} icon={<KeyRound className="w-5 h-5" />} title="계정과 비밀번호" summary="내 정보 관리와 비밀번호를 잊었을 때의 방법입니다.">
              <Bullets
                items={[
                  <><B>환경 설정</B> → <B>Account</B>에서 이름과 프로필 사진을 바꿉니다. 사진은 둥근 틀에 맞춰 위치와 크기를 직접 조절할 수 있습니다. 부서와 직책은 인사부가 관리하므로 직접 바꿀 수 없습니다.</>,
                  <>같은 곳에 <strong>비상 이메일</strong>(네이버·지메일 등 개인 메일)을 등록해 두면 비밀번호를 잊었을 때 인사부 확인이 빨라집니다.</>,
                  <>비밀번호를 잊었다면 로그인 창 아래 <B>비밀번호를 잃어버렸어요</B>를 눌러 이름과 아이디를 남기세요. 자동 메일은 보내지 않고, 인사부 담당자가 직접 확인한 뒤 전화나 메일로 안내합니다.</>,
                  <>AI 기능을 쓰려면 <B>환경 설정</B> → <B>AI API</B>에서 키를 등록해야 합니다. 방법은 위쪽 탭 <strong>AI 키 등록 &amp; 요금</strong>을 보세요.</>,
                ]}
              />
              <Note kind="warn" title="계정이 비활성화되면">
                퇴사·휴직 등으로 인사부가 계정을 비활성화하면 로그인이 막히고 &quot;비활성화된 계정입니다&quot;라고 나옵니다. 기사와 기록은 지워지지 않으며 인사부가 다시 사용으로 바꾸면 돌아옵니다.
              </Note>
            </Section>

            <Section id="rp-faq" no={9} icon={<HelpCircle className="w-5 h-5" />} title="자주 묻는 질문" summary="막혔을 때 먼저 확인해 보세요.">
              <div className="space-y-3">
                {[
                  ['녹음 받아쓰기 버튼이 안 보여요.', '인터뷰 시작 전에는 취재 메모 칸 아래, 시작 후에는 답변 입력칸 위에 있습니다. AI 도구 → AI 초안 탭의 대화 쪽 화면인지 확인하세요.'],
                  ['엔진 옆에 (키 없음)이라고 떠요.', '그 서비스의 키가 아직 등록되지 않았다는 뜻입니다. 환경 설정 → AI API에서 키를 등록하거나, 키가 있는 엔진(예: Gemini)을 고르세요.'],
                  ['AI가 “지금 혼잡하다”고 해요.', 'AI 서비스가 잠시 몰릴 때 나오는 안내입니다. 자동으로 두 번 다시 시도하며, 계속되면 잠시 뒤에 다시 해 주세요.'],
                  ['초안에 노랑으로 표시된 문장이 많아요.', '내가 준 자료에서 같은 내용을 못 찾았다는 뜻입니다. 자료를 더 넣거나, 해당 문장의 사실을 확인한 뒤 고치거나 지우세요.'],
                  ['알림이 안 보여요.', '종 모양을 눌러 목록을 새로 열어 보세요. 그래도 없으면 화면을 새로고침하세요. 본인이 한 행동(예: 내 기사에 내가 남긴 피드백)에도 알림이 올 수 있습니다.'],
                  ['실수로 글을 지웠어요.', '왼쪽 메뉴 History에서 이전 버전을 골라 되돌리세요.'],
                ].map(([q, a]) => (
                  <div key={q} className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                    <div className="text-[14px] font-bold text-white mb-1">{q}</div>
                    <p className="text-[13px] text-slate-300 leading-7">{a}</p>
                  </div>
                ))}
              </div>
            </Section>
          </GuideLayout>
        )}

        {/* 3. 인사 관리자용 안내서 */}
        {activeTab === 'hr' && (
          <GuideLayout toc={HR_TOC}>
            <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2 text-white font-extrabold text-base">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                <span>인사 포털에서 하는 일</span>
              </div>
              <p className="text-[13px] text-slate-300 leading-7">
                인사 관리자(인사부 소속 + 가입 승인 권한)는 <strong className="text-white">사람과 조직</strong>을 관리합니다. 기사 검토·승인·출고 같은 기사 업무는 할 수 없습니다. 인사 포털 맨 위에도 🔔 알림이 있어, 가입 신청이 들어오면 알려 줍니다.
              </p>
            </div>

            <Section id="hr-staff" no={1} icon={<Users className="w-5 h-5" />} title="직원 명부·수정·비활성화" summary="전체 직원을 보고, 부서·직책·권한을 바꾸고, 계정을 잠시 막습니다.">
              <Bullets
                items={[
                  <>첫 화면 <B>직원 관리</B>에서 모든 직원의 이름·이메일·소속 부서·직책·직급·시스템 역할을 볼 수 있습니다. 부서 필터와 검색(이름·이메일·부서·직책)을 쓸 수 있습니다.</>,
                  <>비활성화된 직원은 이름 옆에 <strong>비활성</strong> 표시가 붙고 흐리게 보입니다.</>,
                ]}
              />
              <Sub>정보 수정하기</Sub>
              <Steps
                items={[
                  <>직원 줄 오른쪽 <B>수정</B>을 누릅니다. (본인 줄에는 버튼이 없습니다.)</>,
                  <><strong>소속 부서 · 직책 · 직급 · 시스템 역할</strong>을 고르고 <B>저장</B>합니다.</>,
                  <>저장하면 그 직원에게 🔔 &quot;인사 정보 변경&quot; 알림이 가고, <strong>인사·권한 변경 기록</strong>에 누가 무엇을 바꿨는지 남습니다.</>,
                ]}
              />
              <Note kind="warn" title="직급과 역할은 권한과 연결됩니다">
                직급이 <strong>부장·차장</strong>이거나 역할이 <strong>데스크·편집국장</strong>이면 <strong>같은 부서</strong> 기사를 검토·승인·배정할 수 있습니다. 부서를 옮기면 검토할 수 있는 기사도 바뀌니 신중히 바꿔 주세요. 단, <strong>출고 대기 검토</strong> 목록은 <strong>부장 이상</strong>(부장 직급 또는 편집국장 역할)에게만 보입니다.
              </Note>
              <Sub>계정 비활성화 / 다시 사용</Sub>
              <Bullets
                items={[
                  <><B>비활성화</B>를 누르면 <strong>로그인이 막히고</strong> 지금 접속 중이어도 접속이 끊깁니다(이미 열린 화면은 최대 1시간 안에 끊길 수 있습니다). 로그인 화면에는 &quot;비활성화된 계정입니다&quot;가 나옵니다.</>,
                  <>삭제가 아니므로 <strong>기사와 기록은 그대로</strong> 남습니다. <B>다시 사용</B>을 누르면 바로 복구됩니다.</>,
                  <>본인 계정은 비활성화할 수 없습니다.</>,
                ]}
              />
            </Section>

            <Section id="hr-signup" no={2} icon={<UserCheck className="w-5 h-5" />} title="가입 승인" summary="신규 입사자의 가입을 확인하고 부서와 직책을 정해 줍니다.">
              <Steps
                items={[
                  <>신규 입사자가 로그인 화면에서 가입을 신청하면 🔔에 <strong>&quot;가입 승인 요청&quot;</strong> 알림이 오고, <B>가입 승인 관리</B> 목록에 대기 건수가 나타납니다. 알림을 누르면 이 메뉴로 바로 이동합니다.</>,
                  <>신청자 정보를 확인하고 <strong>소속 부서</strong>와 <strong>공식 직책</strong>, 직급·시스템 역할을 고릅니다.</>,
                  <>신청자는 가입하자마자 받은 임시 비밀번호로 로그인할 수 있지만, <B>승인 전에는 대시보드와 공유된 기사를 읽기만</B> 할 수 있습니다. 부서·직책·직급·역할을 정하고 <B>승인</B>을 누르면 프로젝트 만들기 등 모든 기능이 열립니다. 승인하지 않을 신청은 <B>반려</B>하며, 반려하면 그 계정은 사용이 중지됩니다.</>,
                ]}
              />
              <Note>가입은 회사 이메일 도메인으로만 신청할 수 있고, 임시 비밀번호는 신청 직후 신청자 화면에만 한 번 나옵니다. 잊어버렸다면 로그인 화면의 [비밀번호를 잃어버렸어요]로 신고하면 임시 비밀번호를 다시 발급받을 수 있습니다.</Note>
            </Section>

            <Section id="hr-reset" no={3} icon={<PhoneCall className="w-5 h-5" />} title="비밀번호 분실 신고" summary="시스템이 메일을 자동 발송하지 않습니다. 담당자가 직접 확인합니다.">
              <Steps
                items={[
                  <>직원이 로그인 창에서 분실 신고를 하면 <B>비밀번호 분실 신고</B> 메뉴에 목록과 미처리 건수가 뜹니다.</>,
                  <>신고자의 복구 이메일이나 사내 전화로 직접 연락해 <strong>본인 확인</strong>을 합니다.</>,
                  <>처리가 끝나면 <B>처리 완료</B>를 누르고 메모(예: &quot;유선 확인 완료&quot;)를 남깁니다.</>,
                ]}
              />
              <Note kind="warn" title="복구 이메일이 없는 직원">
                <strong>[복구 이메일 없음, 직접 확인 필요]</strong> 표시가 있으면 사내 유선 전화나 대면으로 확인해 주세요.
              </Note>
            </Section>

            <Section id="hr-master" no={4} icon={<Building2 className="w-5 h-5" />} title="부서·직책 관리" summary="회사 조직 개편과 직책 서열을 관리합니다.">
              <Bullets
                items={[
                  <><B>부서 및 조직 관리</B> 새 부서 추가, 이름·표시 순서 변경, 사용 중지/재개.</>,
                  <><B>직책 마스터 관리</B> 국장·부장·차장·팀장·평기자·수습기자 등 공식 직책을 관리하고 정렬 순서를 정합니다.</>,
                  <>사용을 중지한 부서·직책은 가입 승인과 직원 수정의 선택 목록에 나오지 않습니다.</>,
                ]}
              />
            </Section>

            <Section id="hr-audit" no={5} icon={<History className="w-5 h-5" />} title="인사·권한 변경 기록" summary="누가 언제 무엇을 바꿨는지 자동으로 남습니다.">
              <Bullets
                items={[
                  <>왼쪽 메뉴 <B>인사·권한 변경 기록</B>에서 최근 200건을 최신순으로 봅니다.</>,
                  <>직원의 부서·직책·직급·역할·가입 승인 권한·계정 사용 여부가 바뀌거나, 부서·직책이 추가·이름 변경·사용 중지되면 자동으로 기록됩니다. 예: <em>&quot;김기자 — 부서: 정치부 → 경제부&quot;</em></>,
                  <>기록은 인사 관리자만 볼 수 있고, 수정하거나 지울 수 없습니다.</>,
                  <>기사 관련 기록(작성·검토 요청·승인·출고 등)은 각 기사의 업무 이력에서 따로 볼 수 있습니다.</>,
                ]}
              />
            </Section>

            <Section id="hr-rules" no={6} icon={<AlertCircle className="w-5 h-5" />} title="권한 규칙과 보안 수칙" summary="서버가 실제로 지키는 규칙입니다. 화면 버튼과 상관없이 어기면 거절됩니다.">
              <div className="rounded-xl border border-slate-800 overflow-x-auto">
                <table className="w-full text-[13px] text-left">
                  <thead className="bg-slate-900 text-slate-300">
                    <tr>
                      <th className="p-3 font-bold whitespace-nowrap">업무</th>
                      <th className="p-3 font-bold">할 수 있는 사람</th>
                      <th className="p-3 font-bold">조건</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300 align-top">
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">검토 요청</td><td className="p-3">기사 작성자</td><td className="p-3">작성중 또는 수정요청 상태</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">수정 요청 · 승인</td><td className="p-3">데스크 (부장·차장·데스크·편집국장)</td><td className="p-3">같은 부서 기사, 검토중 상태. 본인 기사는 승인 불가</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">최종 출고</td><td className="p-3">부장</td><td className="p-3">출고 대기 상태</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">기사 배정·마감 변경</td><td className="p-3">데스크</td><td className="p-3">같은 부서 기자에게만, 출고 완료 기사는 불가</td></tr>
                    <tr><td className="p-3 font-bold text-white whitespace-nowrap">직원 정보·계정 관리</td><td className="p-3">인사 관리자</td><td className="p-3">본인 계정은 수정·비활성화 불가</td></tr>
                  </tbody>
                </table>
              </div>
              <Note kind="warn" title="인사관리자 보안 수칙">
                비밀번호 분실 신고는 개인정보 보호를 위해 시스템이 메일을 보내지 않습니다. 반드시 담당자가 전화나 대면으로 신원을 확인한 뒤 안내해 주세요. 계정 비활성화·직급 변경은 기록에 남으니, 요청 근거(결재 등)를 별도로 보관하세요.
              </Note>
            </Section>
          </GuideLayout>
        )}

        {/* 3-2. API 연결 안내서 컨텐츠 */}
        {activeTab === 'api' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            <div className="flex items-center space-x-2 text-slate-200">
              <KeyRound className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2 className="text-sm sm:text-base font-bold">AI 서비스 연결과 요금 (Gemini · OpenAI · Claude · 구글 클라우드)</h2>
            </div>

            <p className="text-[13px] text-slate-300 leading-relaxed">
              PRESS-CMS의 AI 기능은 <strong className="text-white">각자 발급받은 열쇠(API 키)</strong>로 움직입니다. 열쇠는 환경설정의 <strong className="text-white">AI 서비스 설정</strong>에 한 번만 등록하면 내 계정에 암호화되어 저장되고, 사용 요금은 열쇠를 발급받은 회사에서 내 계정으로 청구됩니다.
            </p>

            {/* 한눈에 보기 */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto">
              <table className="w-full text-[13px] text-left">
                <thead>
                  <tr className="bg-slate-900 text-slate-300">
                    <th className="p-3 font-bold">서비스</th>
                    <th className="p-3 font-bold">글쓰기·검수·정리</th>
                    <th className="p-3 font-bold">녹음 받아쓰기</th>
                    <th className="p-3 font-bold">이미지 만들기</th>
                    <th className="p-3 font-bold">참고</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300 divide-y divide-slate-800 align-top">
                  <tr>
                    <td className="p-3 font-bold text-white">Google Gemini</td>
                    <td className="p-3">가능</td>
                    <td className="p-3">가능 (화자 구분은 AI가 글로 표시)</td>
                    <td className="p-3">가능</td>
                    <td className="p-3">무료로 쓸 수 있는 한도가 있습니다</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">OpenAI</td>
                    <td className="p-3">가능</td>
                    <td className="p-3">가능 (인터뷰는 화자 구분 전용 모델 시도)</td>
                    <td className="p-3">가능</td>
                    <td className="p-3">결제(충전) 후 사용</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">Claude (Anthropic)</td>
                    <td className="p-3">가능</td>
                    <td className="p-3 text-amber-300">불가 — 소리를 들을 수 없습니다</td>
                    <td className="p-3 text-amber-300">불가 — 그림을 만들지 못합니다</td>
                    <td className="p-3">글 작업 전용. 받아쓰기·이미지는 다른 서비스를 고르세요</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">구글 클라우드</td>
                    <td className="p-3 text-slate-500">해당 없음</td>
                    <td className="p-3">가능 (4개 언어, 인터뷰 화자 구분, 30분까지)</td>
                    <td className="p-3 text-slate-500">해당 없음</td>
                    <td className="p-3">받아쓰기 전용 키. 아래 순서가 조금 더 깁니다</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 키 등록 공통 */}
              <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2.5">
                <h3 className="text-sm font-bold text-slate-100">① 키를 등록하는 곳</h3>
                <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                  <li>왼쪽 메뉴의 <strong className="text-white">환경설정 → AI 서비스 설정</strong>으로 이동합니다.</li>
                  <li>쓰려는 서비스를 고르고 키를 붙여 넣은 뒤 <strong className="text-white">[확인 후 저장]</strong>을 누릅니다. 맞는 키인지 서버가 먼저 확인합니다.</li>
                  <li>구글 클라우드는 같은 화면 아래쪽의 <strong className="text-white">구글 클라우드 키</strong> 칸에 따로 등록합니다.</li>
                  <li>화면에는 키의 뒤 4글자만 보입니다. 다른 컴퓨터에서 로그인해도 다시 넣을 필요가 없습니다.</li>
                  <li className="text-amber-300">키는 비밀번호와 같습니다. 채팅·메신저·메일에 붙여 넣지 마세요. 노출됐다면 발급처에서 바로 삭제하고 새로 만드세요.</li>
                </ul>
              </div>

              {/* Gemini */}
              <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2.5">
                <h3 className="text-sm font-bold text-slate-100">② Google Gemini 키 받기</h3>
                <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                  <li>구글 계정으로 <strong className="text-white">Google AI Studio</strong>(aistudio.google.com)에 들어갑니다.</li>
                  <li><strong className="text-white">Get API key(API 키 받기)</strong>에서 새 키를 만들고 복사합니다.</li>
                  <li>환경설정에서 <strong className="text-white">Google Gemini</strong>를 고르고 붙여 넣습니다.</li>
                  <li className="text-amber-300">무료 한도로 쓰면 입력한 내용이 구글의 서비스 개선에 쓰일 수 있다고 안내되어 있습니다. 취재 중인 비공개 내용은 결제를 연결한 유료 키로 쓰는 것을 권합니다.</li>
                </ul>
              </div>

              {/* OpenAI */}
              <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2.5">
                <h3 className="text-sm font-bold text-slate-100">③ OpenAI 키 받기</h3>
                <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                  <li><strong className="text-white">OpenAI 개발자 사이트</strong>(platform.openai.com)에 로그인합니다.</li>
                  <li>결제 정보를 등록하고 사용 금액을 충전합니다. (충전 전에는 호출이 거절될 수 있습니다.)</li>
                  <li><strong className="text-white">API keys → Create new secret key</strong>로 만든 키를 바로 복사합니다. 창을 닫으면 다시 볼 수 없습니다.</li>
                  <li>환경설정에서 <strong className="text-white">OpenAI</strong>를 고르고 붙여 넣습니다.</li>
                  <li>이미지 만들기는 계정 인증(조직 확인)이 필요할 수 있습니다.</li>
                </ul>
              </div>

              {/* Claude */}
              <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2.5">
                <h3 className="text-sm font-bold text-slate-100">④ Claude(Anthropic) 키 받기</h3>
                <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                  <li><strong className="text-white">Anthropic 콘솔</strong>(console.anthropic.com)에 로그인하고 결제(충전)를 설정합니다.</li>
                  <li><strong className="text-white">API Keys</strong> 메뉴에서 키를 만들어 복사합니다.</li>
                  <li>환경설정에서 <strong className="text-white">Anthropic</strong>을 고르고 붙여 넣습니다.</li>
                  <li>Claude는 <strong className="text-white">기사 검수·초안·원자료 정리</strong>에 쓸 수 있지만, 녹음 받아쓰기와 이미지 만들기는 하지 못합니다. 이 두 기능을 쓰려면 Gemini·OpenAI·구글 클라우드 키를 함께 등록해 두세요.</li>
                  <li>Claude의 Claude.ai 구독(월정액)과 API 키는 별개이며, API는 쓴 만큼 따로 청구됩니다.</li>
                </ul>
              </div>
            </div>

            {/* 구글 클라우드 */}
            <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-emerald-900/60 space-y-2.5">
              <h3 className="text-sm font-bold text-emerald-300">⑤ 구글 클라우드 받아쓰기 키 만들기 (조금 긴 순서)</h3>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                긴 인터뷰나 정확한 화자 구분이 필요할 때 씁니다. 처음 한 번만 설정하면 됩니다. 어려우면 정보시스템 담당자와 함께 진행하세요.
              </p>
              <ol className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-decimal list-inside">
                <li><strong className="text-white">구글 클라우드 콘솔</strong>(console.cloud.google.com)에서 새 <strong className="text-white">프로젝트</strong>를 만듭니다.</li>
                <li>그 프로젝트에 <strong className="text-white">결제 계정</strong>을 연결합니다. (결제 연결이 없으면 받아쓰기가 거절됩니다.)</li>
                <li>검색창에 <strong className="text-white">Speech-to-Text API</strong>를 입력해 <strong className="text-white">사용 설정</strong>을 누릅니다.</li>
                <li><strong className="text-white">IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기</strong>로 계정을 만들고, 역할에 <strong className="text-white">Cloud Speech 클라이언트</strong>를 줍니다.</li>
                <li>만든 서비스 계정의 <strong className="text-white">키 탭 → 키 추가 → 새 키 만들기 → JSON</strong>을 누르면 파일이 내려받아집니다.</li>
                <li>그 파일을 <strong className="text-white">메모장으로 열어 내용 전체를 복사</strong>해, 환경설정의 <strong className="text-white">구글 클라우드 키</strong> 칸에 붙여 넣고 [확인 후 저장]을 누릅니다.</li>
                <li>내려받은 JSON 파일은 등록이 끝나면 삭제하세요. 이 파일이 곧 열쇠입니다.</li>
                <li>예상치 못한 요금을 막으려면 구글 클라우드의 <strong className="text-white">결제 → 예산 및 알림</strong>에서 월 한도 알림을 걸어 두세요.</li>
              </ol>
              <p className="text-xs text-amber-300 leading-relaxed">
                키 확인은 로그인(인증)까지만 점검합니다. API 사용 설정·결제·역할이 빠졌다면 실제로 받아쓰기를 처음 실행할 때 &quot;허용하지 않았습니다&quot; 안내가 나옵니다.
              </p>
            </div>

            {/* 받아쓰기 사용법 */}
            <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2.5">
              <h3 className="text-sm font-bold text-slate-100">⑥ 녹음 받아쓰기 쓰는 법</h3>
              <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                <li>기사 편집기 → <strong className="text-white">[AI 도구] → [AI 초안]</strong> 탭의 &quot;초기 취재 메모&quot; 아래 <strong className="text-white">[녹음 받아쓰기]</strong>를 누릅니다. 인터뷰를 이미 시작했다면 답변 입력칸 위의 <strong className="text-white">[녹음 받아쓰기 (녹음으로 답하기)]</strong>를 누르세요.</li>
                <li><strong className="text-white">말하는 언어</strong>(한국어·영어·일본어·중국어)와 <strong className="text-white">방식</strong>을 고릅니다. 발표·강연은 한 사람이 말하는 경우, 인터뷰는 말하는 사람별로 &quot;화자1:&quot;, &quot;화자2:&quot;로 나눠 적습니다.</li>
                <li><strong className="text-white">엔진</strong>(Gemini·OpenAI·구글 클라우드)을 고르고 녹음 파일을 올립니다. Gemini·OpenAI는 10MB까지, 구글 클라우드는 60MB·30분까지입니다.</li>
                <li>인터뷰로 받아쓰면 <strong className="text-white">화자 이름 바꾸기</strong> 칸이 나옵니다. &quot;화자1&quot; 옆에 실제 이름을 적고 [이름 적용]을 누르면 메모 전체에 반영됩니다.</li>
                <li>화자 구분은 완벽하지 않습니다. 특히 긴 녹음을 나눠 처리하는 구글 클라우드는 조각마다 화자 번호가 다시 매겨질 수 있으니 <strong className="text-white">꼭 들으면서 확인</strong>해 주세요.</li>
                <li className="text-amber-300">녹음은 선택한 외부 서비스(구글·OpenAI)로 전송됩니다. 취재원에게 녹음과 AI 처리 사실을 알리고 동의를 받아 두세요. 녹음 파일은 PRESS-CMS에 저장되지 않고 받아쓴 글만 남습니다.</li>
              </ul>
            </div>

            {/* 요금 */}
            <div className="flex items-center space-x-2 text-slate-200 pt-2">
              <Clock className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2 className="text-sm sm:text-base font-bold">요금 정리 (2026년 10월 8일 공식 안내 기준, 달러)</h2>
            </div>

            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto">
              <table className="w-full text-[13px] text-left">
                <thead>
                  <tr className="bg-slate-900 text-slate-300">
                    <th className="p-3 font-bold">항목</th>
                    <th className="p-3 font-bold">요금</th>
                    <th className="p-3 font-bold">녹음 1시간 대략</th>
                    <th className="p-3 font-bold">알아둘 점</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300 divide-y divide-slate-800 align-top">
                  <tr className="bg-emerald-950/30">
                    <td className="p-3 font-bold text-white">구글 클라우드 받아쓰기<br /><span className="font-normal text-slate-400">(Speech-to-Text V2, Chirp 계열)</span></td>
                    <td className="p-3">분당 $0.016<br /><span className="text-slate-400">(월 50만 분까지 기준 요금)</span></td>
                    <td className="p-3">약 $0.96<br /><span className="text-slate-400">(1달러 1,400원 가정 시 약 1,350원)</span></td>
                    <td className="p-3">1초 단위로 계산. 무료 한도는 안내되어 있지 않고, 신규 고객에게 $300 체험 크레딧이 있습니다. 화자 구분 추가 요금은 안내에 없으나 청구서에서 확인하세요. 서버 오류로 실패한 요청은 청구되지 않습니다.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">Gemini 받아쓰기<br /><span className="font-normal text-slate-400">(Gemini 3.8 Flash)</span></td>
                    <td className="p-3">글자 조각(토큰) 단위<br />입력 $0.75 · 출력 $3.75 (100만 토큰당, 2026-12-31까지)<br /><span className="text-slate-400">2027-01-01부터 입력 $1.50 · 출력 $7.50</span></td>
                    <td className="p-3">약 $0.1~0.3 (추정)</td>
                    <td className="p-3">소리 입력 요금이 따로 표기되지 않아 위 값으로 계산한 추정입니다. 무료 한도가 있으나 무료 사용분은 서비스 개선에 쓰일 수 있습니다.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">OpenAI 받아쓰기<br /><span className="font-normal text-slate-400">(기본 whisper-1)</span></td>
                    <td className="p-3">분당 $0.006<br /><span className="text-slate-400">(gpt-4o-transcribe 분당 $0.006, gpt-4o-mini-transcribe 분당 $0.003)</span></td>
                    <td className="p-3">약 $0.36</td>
                    <td className="p-3">whisper-1의 분당 $0.006은 OpenAI 공식 표가 아닌 외부 자료 기준이라 확인이 필요합니다. 화자 구분 모델(gpt-4o-transcribe-diarize)은 소리 입력 100만 토큰당 $2.50, 출력 $10으로 분당 환산이 안내되어 있지 않습니다.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">이미지 만들기 (Gemini)</td>
                    <td className="p-3">1장(1K 크기) 약 $0.034~0.067<br /><span className="text-slate-400">모델에 따라 다름</span></td>
                    <td className="p-3">—</td>
                    <td className="p-3">이미지 모델은 무료 한도가 없습니다. 이 프로그램이 쓰는 이미지 모델이 목록에 없다고 나오면 관리자에게 모델 변경을 요청하세요.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">이미지 만들기 (OpenAI)</td>
                    <td className="p-3">장당 가격을 공식 표에서 확인하지 못함</td>
                    <td className="p-3">—</td>
                    <td className="p-3">OpenAI 요금 계산기에서 직접 확인해 주세요.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-bold text-white">Claude (글 작업)</td>
                    <td className="p-3">이번 조사에서 공식 요금을 확인하지 못함</td>
                    <td className="p-3">—</td>
                    <td className="p-3">Anthropic 콘솔의 요금 안내를 확인하세요. 받아쓰기·이미지에는 쓸 수 없습니다.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-emerald-900/60 space-y-2">
              <h3 className="text-sm font-bold text-emerald-300">구글 클라우드로 받아쓰기하면 얼마나 나올까?</h3>
              <ul className="text-[13px] text-slate-300 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                <li>30분 인터뷰 1건 ≈ $0.48 (약 670원), 1시간 ≈ $0.96 (약 1,350원)</li>
                <li>하루 1시간씩 한 달(20일) 받아쓰면 ≈ $19 (약 2만 7천 원)</li>
                <li>계산 기준: 분당 $0.016, 1달러 1,400원 가정. 환율과 구글의 요금 정책에 따라 달라질 수 있습니다.</li>
                <li>이 프로그램은 긴 녹음을 약 55초 조각으로 나눠 보내며, 조각마다 초 단위로 계산되므로 전체 길이 기준과 거의 같습니다.</li>
                <li>무음 구간도 처리된 시간만큼 청구될 수 있으니, 불필요한 앞뒤 구간은 잘라서 올리면 절약됩니다.</li>
              </ul>
            </div>

            <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2">
              <h3 className="text-sm font-bold text-slate-100">요금 확인 출처와 주의</h3>
              <ul className="text-[13px] text-slate-400 space-y-1.5 leading-relaxed pl-2 list-disc list-inside">
                <li>구글 클라우드: cloud.google.com/speech-to-text/pricing (V2 표준 모델 요금)</li>
                <li>Gemini: ai.google.dev/gemini-api/docs/pricing (3.8 Flash, 이미지 모델 표)</li>
                <li>OpenAI: developers.openai.com/api/docs/pricing 및 모델 소개 페이지 (gpt-4o-transcribe 계열)</li>
                <li>요금과 모델 이름은 자주 바뀝니다. 실제 결제 전에 각 사이트의 최신 요금표를 꼭 확인하세요. 표시된 환산 금액은 이해를 돕기 위한 어림값입니다.</li>
                <li>AI 호출 횟수와 실패율은 환경설정 아래쪽의 <strong className="text-slate-200">AI 사용 현황</strong> 표에서 볼 수 있습니다. 금액은 각 서비스의 사용량 화면에서 확인합니다.</li>
              </ul>
            </div>
          </div>
        )}

        {/* 4. 바로가기 버튼 액션 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <div className="flex items-center space-x-2 text-[13px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>PRESS-CMS는 언론사 기자 및 인사 관리자의 안전한 업무를 지원합니다.</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-md transition-colors cursor-pointer"
            >
              <span>대시보드로 돌아가기</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
