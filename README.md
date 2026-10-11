# PRESS-CMS : Newsroom Editorial Workspace

언론사 내부 기자·데스크(편집자)를 위한 **기사 편집 / AI 보조 검수 / 미디어 관리 / 송고 지원 시스템**입니다.

Google AI Studio에서 설계된 UI/UX 프로토타입을 바탕으로 코드베이스 분석 및 최적화(Phase 0)를 완료하였으며, 현재는 **React + Supabase(로그인·DB·파일 저장·서버 함수)** 구조로 실제 서비스 형태로 동작하고 있습니다.

> **핵심 원칙**: **기사는 기자가 직접 작성합니다. AI는 기사를 새로 생성하거나 전체 기사를 재작성(Rewrite)하지 않습니다.**  
> AI는 정보 오류 탐지, 맞춤법/오타 교정 제안, 취재 보완 질문, 미디어 분석·분류 등 보조 역할만 수행하며, 최종 판단과 본문 반영은 기자가 직접 승인합니다.

---

## 1. 프로젝트 핵심 원칙

### 1.1 기자 원문 우선 (Journalist-First)
- AI 기사 자동 생성 및 전체 Rewrite 절대 금지
- 문맥 이어 쓰기(Continue Writing) 형태의 임의 자동 작성 기능 배제
- AI 검수 결과는 제안(Suggestion) 및 확인 사항으로만 제공되며, 기자의 명시적 승인([제안 적용]) 하에서만 본문 반영
- 정보 오류 가능성은 AI가 본문을 임의 수정하지 않고 기자가 확인할 사항으로 표시

### 1.2 에디터 중심 워크스페이스 (Editor-Centric)
- AI가 주가 되는 서비스가 아닌, **Article Editor(기사 작성 공간)**가 중심
- 화면 시각적 우선순위:
  1. 기사 본문 (Headline / Subtitle / Blocks)
  2. 사람 간 협업 피드백 (Desk ↔ Reporter)
  3. AI 보조 검수 (Fact / Typo / Question)
  4. 미디어 라이브러리 (Compact Bottom Drawer)

### 1.3 운영 환경 보안 (Zero-Trust Security)
- 운영 환경에서는 AI Provider(Gemini, OpenAI 등)의 API Key를 브라우저에 노출하거나 저장하지 않음
- 모든 AI 호출 및 기사 송고 권한 검증은 FastAPI 백엔드에서 격리 통제

```text
[React Client] ──(REST API / JWT)──> [FastAPI Backend] ──> [AI Provider API]
                                            │
                                            ├──> [MySQL 8.0]
                                            └──> [S3 / MinIO Object Storage]
```

---

## 2. 기술 스택 현황

| 구분 | 현재 사용 중 |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Vite 8, Lucide-React |
| **본문 편집기** | TipTap(ProseMirror) 기반 워드/한글형 단일 문서 편집기 (MIT 라이선스) |
| **Backend / DB** | Supabase (PostgreSQL, 로그인, RLS 권한, RPC 함수, Edge Function). 변경 이력은 `supabase/migrations` |
| **Media Storage** | Supabase Storage (비공개 저장 + 화면 표시용 임시 주소) |
| **AI** | Supabase Edge Function을 통한 AI 검수 / 질문형 인터뷰 초안 (기사 자동 생성·재작성은 금지) |

> 아래 6~8장의 MySQL/FastAPI 내용은 초기 설계안으로, 현재 구조와 다릅니다. 참고용으로만 남겨 둡니다.

--- | :--- | :--- |
| **Frontend** | React 19, TypeScript 7, Tailwind CSS v4, Vite 8.3, Lucide-React | React 19 SPA + API Client 계층 (Axios / TanStack Query) |
| **Backend** | 클라이언트 인메모리 Mock State (`mockData.ts`) | **FastAPI** (비동기 처리, Pydantic v2, JWT 인증, AI 프록시) |
| **Database** | 없음 (Mock Data 시뮬레이션) | **MySQL 8.0** (10개 정규화 테이블, SQLAlchemy 2.0 ORM) |
| **Media Storage** | Unsplash 외부 CDN URL 참조 | **AWS S3 / MinIO Object Storage** (대용량 보도사진·영상 분리) |
| **AI Engine** | UI 시뮬레이션 및 LocalStorage 설정 | **Google Gemini / Claude API** (FastAPI 백엔드를 통한 프록시 호출) |

---

## 3. 구현 완료된 주요 기능 (12개 영역)

### 3.1 로그인 및 사용자 페르소나 (Login & User)
- 4명의 언론사 페르소나(수습, 평기자, 차장, 부장) 1-클릭 테스트 로그인
- 사내 이메일 계정 및 비밀번호 폼 인증 인터랙션

### 3.2 프로젝트 대시보드 (Dashboard)
- 내 프로젝트 / 전체 프로젝트 탭 분기
- **자동 동기화**: 프로젝트 관리는 30초, 업무 대시보드는 20초마다(탭이 보일 때·창으로 돌아올 때 포함) 조용히 새로 불러옴. 바뀐 내용이 있을 때만 화면 갱신(깜빡임 없음)
- **데스크 검토 큐에 내 기사 포함**: 계정 하나로 시험·소규모 운영 시에도 '검토 요청된 기사', '기자 수정 대기 중'에 본인 기사가 보이고 '내 기사' 배지 표시(기사 열기 버튼). 단, DB의 본인 기사 자기 승인 금지 규칙은 그대로
- **요약 카드 바로가기**: 업무 대시보드의 요약 카드(초안 작성중·수정 요청됨·데스크 검토중·출고대기·출고 완료, 데스크의 검토 요청·수정 대기·출고 대기)를 누르면 같은 이름의 목록으로 스크롤 이동(손가락 모양 커서, 도착 목록 잠깐 강조)
- 기사 제목, 프로젝트명, 기자명 실시간 검색 및 상태별 필터(`Draft`, `Reviewing`, `Ready`)
- 최근 수정일시 기준 자동 정렬
- 신규 프로젝트 생성, 프로젝트명/기사제목 수정(Rename), 복제(Duplicate), 삭제(Delete)
- 프로덕션 MySQL RDBMS 연동 설계 뷰어 내장

### 3.3 기사 본문 편집기 (Article Editor)
- 워드/한글처럼 문서 하나에 이어서 쓰는 **TipTap(ProseMirror) 단일 문서 편집기** (2026-10-08에 기존 블록 편집기를 대체)
  - Enter로 문단 나누기, 줄 사이 자유로운 수정·이동
  - 사진·영상: 손잡이 없이 바로 끌어서 이동, 놓을 수 있는 자리 점선·파란 선 표시, 끌 때 화면 자동 스크롤
  - 미디어 라이브러리 삽입, 컴퓨터 이미지 파일 끌어다 놓기, TXT 가져오기
  - 800ms 자동 저장(실패 시 5초 후 재시도), 저장 내용은 기존과 같은 `article_blocks` 테이블에 블록으로 나뉘어 저장
  - 형광펜 피드백, AI 검수 표시, 글 드래그 → [피드백 작성]
  - 다른 사람이 동시에 블록을 바꾼 경우 자동 재시도를 멈추고 "최신 기사 불러오기" 안내
- **사진 자르기·확대**: `[자르기·확대]`로 사진을 16:9 칸에 맞춰 끌어서 보이는 부분을 정하고 확대(100~400%). 값은 사진 블록 `text` 칸에 `focus:가로,세로,확대`로 기록(DB 구조 변경 없음, 글자 수에서 제외). 값이 없으면 원본 전체 표시. 독자 미리보기(`CroppedImage`)와 워드 내보내기(캔버스로 잘라 담기)에도 적용
- **내보내기**: 워드(.docx, 사진 포함 — 외부 라이브러리 없이 `docxExport.ts`로 직접 생성) / 텍스트(.txt). 내보내기 메뉴는 상단 바의 가로 스크롤에 잘리지 않도록 화면 최상단 층에 띄움
- **화면 이동**: 편집기에서 뒤로가기·새로고침 시 대시보드의 '프로젝트 관리'로 돌아옴(마지막 보던 대시보드 화면을 sessionStorage에 기억)
- **부장 검토 모드**: 본문은 읽기 전용이지만 글을 드래그해 **피드백은 남길 수 있음**
- 알려진 제한: 사진 "교체" 버튼 없음(삭제 후 다시 삽입), 여러 문단에 걸친 글 선택 피드백 미지원
- 개발 서버를 `http://192.168...` 같은 비보안 주소로 열면 Brave 등에서 파일 다운로드가 차단될 수 있음 → `localhost`로 접속하거나 `https` 적용
- 단축키(Ctrl+S / Cmd+S) 수동 저장

---

### 3.4 실시간 원고 분량 측정 (Metrics)
- 구시대적인 200자 원고지 기준 탈피
- 공백 제외 글자 수, 공백 포함 글자 수, 총 문단 수, 예상 독서 시간 실시간 산출

### 3.5 AI 3대 기사 검수 시스템 (AI Review)
우측 사이드바 전용 패널을 통해 제공되며, 기사 원문과 결과 데이터가 철저히 분리됩니다.
1. **정보 오류 (Fact-checking)**: 통계, 날짜, 정당/직함 오류 대조 → 기사 위치 하이라이트, `[확인 완료]`, `[제안 적용]`, `[무시]`
2. **오타 교정 (Spelling & Grammar)**: 표준어 규정 및 띄어쓰기 오류 검출 → 원문-수정안 대조 후 원클릭 교체
3. **확인 질문 (Missing Information)**: 출시일, 가격, 공식 대변인 워딩 등 누락된 핵심 팩트를 AI가 기자에게 역질문하고 취재 메모 기록

### 3.6 협업 피드백 시스템 (Editorial Feedback)
- AI 검수와 분리된 **사람 대 사람(데스크-기자) 간 협업 코멘트**
- 기사 전체 메모 및 특정 문단(#01 문단) 지정 피드백 작성
- 스레드 형태의 답글(Reply) 지원 및 해결 여부(`Resolve`) 상태 토글

### 3.6.1 AI 도구 패널 (AI Tools)
- 편집기 상단 **[AI 도구] 버튼 하나**로 오른쪽 패널을 열고, 탭으로 이동: AI 초안 | 인포그래픽 | 피드백 | AI 검수 | 미디어
- 모든 탭의 머리글·크기·글자색을 통일 (`PanelHeader.tsx`)
- **인포그래픽**: 기사 속 숫자를 뽑아 차트 카드 이미지 생성 (Edge Function `extract-infographic-data`, 미배포 시 브라우저 내 추출로 대체, 기사에 없는 숫자는 사용하지 않음)
- **AI 초안 작성**: 주제·키워드·톤 입력 → AI 육하원칙 질문(대화) → 제목 후보·리드·본문 문단 조립 → **전체 수정 지시**(예: 20% 짧게) 및 문단별 재작성 (Edge Function `ai-interview-draft`)
- **원자료 정리**: TXT·CSV·MD 파일 불러오기 또는 붙여넣기 → 요약·핵심 사실·수치·발언·시간순·확인 필요로 정리 → 취재 메모에 반영(원문 되돌리기 가능). 발언과 숫자는 원자료에 실제 있는 것만 남김 (Edge Function `organize-raw-data`)
- **웹 자료 가져오기 / 녹음 받아쓰기**: 원자료 칸에서 웹 주소의 글(출처·수집일 자동 기재, 내부망 차단, robots.txt 준수)을 가져오거나, 녹음 파일을 글로 받아 적음 (Edge Function `fetch-web-source`, `transcribe-audio`). 받아쓰기는 언어(한국어·영어·일본어·중국어), 방식(발표·강연 / 인터뷰 화자 구분), 엔진(Gemini·OpenAI·구글 클라우드)을 고르며 화자 이름을 바꿀 수 있음. Gemini·OpenAI는 10MB까지, 구글 클라우드는 화면에서 약 55초 WAV 조각으로 나눠 30분·60MB까지. Claude는 소리를 들을 수 없어 받아쓰기 엔진에서 제외
- **구글 클라우드 키(받아쓰기 전용)**: 환경설정에서 서비스 계정 키(JSON)를 등록하면 `manage-ai-key`가 암호화해 `user_ai_keys`(provider=`googlecloud`)에 저장하고, `transcribe-audio`가 Speech-to-Text V2(Chirp 3, 기본 지역 `us`, 서버 비밀값 `GOOGLE_STT_REGION`으로 `eu` 선택 가능)를 호출. 마이그레이션 `20261008190000_allow_googlecloud_key.sql` 필요. 서버 로직은 모의 응답으로만 시험했고 실제 구글 계정 호출은 시험 전
- **사용자 가이드 "API 연결 & 요금" 탭**: Gemini·OpenAI·Claude·구글 클라우드 키 발급 순서, 기능 비교표, 요금표(2026-10-08 공식 안내 기준)
- 선택 서버 비밀값: `STT_MODEL_OPENAI`(OpenAI 받아쓰기 모델, 기본 `whisper-1`), `IMAGE_MODEL_GEMINI`, `IMAGE_MODEL_OPENAI`, `GOOGLE_STT_REGION`
- **AI 이미지 만들기**: 미디어 라이브러리 [AI 이미지] → 설명글로 이미지 생성 → 올릴 때 출처 "AI 생성", 캡션 [AI 생성 이미지] 자동 표기 (Edge Function `generate-image`)
- **AI 사용 현황**: 모든 AI 호출의 성공 여부·응답 시간·결과 길이를 기록(내용·사용자 이름은 저장 안 함)해 환경설정 하단에서 기능·모델별로 비교 (테이블 `ai_call_logs`). AI 초안을 쓴 기사는 송고 창에 AI 사용 안내 표시
- **개인 AI 키**: 환경설정 1번 칸에서 공급자(Gemini/OpenAI/Anthropic/사내 API)·모델·키를 등록. 키는 계정별로 서버에 암호화 저장되어 어느 컴퓨터에서든 사용 가능하며 화면엔 뒤 4자리만 표시 (Edge Function `manage-ai-key`, 서버 비밀값 `AI_KEY_ENCRYPTION_SECRET` 필요)

### 3.6.2 공개 범위 선택 (Visibility)
- 나만 / 우리 부서 / 전체 3단계 선택창 (`VisibilityPicker.tsx`), 편집기 상단과 프로젝트 대시보드에서 사용

### 3.7 미디어 라이브러리 (Digital Asset Manager)
- 왼쪽 메뉴 **Media 전용 탭** + 기사 편집기 오른쪽 패널의 **[미디어] 탭** (같은 라이브러리, 화면만 다름)
- 표 구성: 사진 | 제목 | 캡션(최대 200자, 줄바꿈 가능) | 기자 | 이메일 | 부서 | [기사에 넣기]
- 검색: 제목·캡션·기자 이름·이메일·부서. 범위: 전체 / 이 기사 프로젝트 / 부서(상위 부서는 하위 부서 포함, `departments` 테이블 기준)
- 기간: 전체 / 연도 / 연·월 / 연·월·일 (달력 입력), 항상 최신순
- 업로드: 이름·이메일·부서 자동 입력(업로드 당시 값을 사진에 기록), 여러 장 선택, 장마다 제목·캡션
- 기사에 넣으면 **캡션과 바이라인(기자 이름)이 자동으로 붙음**, 본문으로 드래그 앤 드롭 삽입 지원
- DB: `media.uploader_department`, `uploader_name`, `uploader_email` 칸 (마이그레이션 `20261008100000`, `20261008110000`)
- 사진 올리기 창: 사진 → 제목 → 캡션만 입력(프로젝트 선택 없음). 기사 편집기에 파일을 끌어다 놓아도 바로 올리지 않고 이 창이 먼저 열림
- **프로젝트 없는 사진**: Media 탭(사진부)에서 올린 사진은 프로젝트 없이 라이브러리에 보관되어 모든 직원이 열람. 편집기 [미디어] 탭에서 올린 사진은 열어 둔 기사의 프로젝트에 보관 (마이그레이션 `20261008120000`, 함수 `analyze-media-image` 재배포 필요)
- **사진 일부 가리기(블러)**: 기사 속 사진의 [일부 가리기]에서 네모로 영역 지정, 흐리게/모자이크, 정도 조절. 가린 사진은 새 파일로 저장되고 원본은 보존

### 3.8 직급 및 기사 송고 권한 관리 (Permission)
- 4단계 직급 체계: `수습` | `평기자` | `차장` | `부장`
- **송고 권한 원칙**: **'부장' 직급만 최종 [기사 송고] 버튼 활성화**
- 비권한자(수습, 평기자, 차장)는 송고 버튼 원천 비노출
- 상단 헤더에서 1-클릭으로 직급을 변경하여 권한 제어 테스트 가능

### 3.9 다중 채널 기사 송고 (Publish)
- 출고 채널은 고정 목록 유지, 전체 선택/해제와 선택 개수 표시, 채널 미선택 시 경고
- 네이버 뉴스, 다음/카카오, 뉴스룸 공식 웹/앱, 지면 CTS 조판망 다중 선택
- 미해결된 AI 정보 오류 및 오타 항목 존재 시 경고 표시
- 송고 진행률 프로그레스 바 및 최종 송고 완료 처리

### 3.10 버전 이력 및 복원 (Version History)
- 자동 저장 및 감수 단계별 타임스탬프 스냅샷 기록
- 이전 스냅샷 선택 시 해당 시점의 원고 본문 복원

### 3.11 최종 독자 화면 미리보기 (Preview)
- 기사 송고 전 포털 웹 뷰, 지면 조판 뷰, 모바일 웹 뷰 3종 미리보기

### 3.12 환경설정 (Settings)
- General(보도 규칙 및 AI 엄격도), AI API(Provider 및 모델 연동), Media(업로드 규격 및 WebP 압축), Account(기자 바이라인 프로필)

---

## 4. Phase 0 코드베이스 정리 및 최적화 성과

본격적인 백엔드 연결에 앞서 불필요한 코드를 탐색하고 의존성을 대폭 경량화했습니다.

### 4.1 의존성 정리 및 충돌 해결
- **Peer Dependency 충돌 해결**: `vite@8.3.0`과 버전 충돌(`ERESOLVE`)을 일으키던 devDependencies의 `esbuild` 직접 선언 제거
- **미사용 패키지 6종 제거**: `@google/genai`, `motion`, `express`, `dotenv`, `tsx`, `@types/express` 정리
- **패키지 경량화**: 총 183개 패키지 중 128개를 정리하여 **55개 핵심 패키지만으로 경량화** 완료

### 4.2 소스 코드 정리 및 보존
- **미사용 Import 정리**: `TopHeader.tsx`, `VersionHistoryModal.tsx` 내 미사용 Lucide 아이콘 제거
- **디자인 시스템 UI 키트 보존**: `EditorialUI.tsx`(Tooltip, Loading, Error, Empty State)는 향후 백엔드 API 통신 상태 처리에 재활용하기 위해 보존(KEEP)

### 4.3 빌드 및 타입 무결성 검증
- `npm install`: 1초 완료, 충돌 및 취약점 0건
- `npm run lint` (`tsc --noEmit`): TypeScript 컴파일 에러 0건
- `npm run build` (`vite build`): 393ms 초고속 프로덕션 번들 빌드 성공

---

## 5. 프로젝트 디렉터리 구조

```text
c:\ShinJaeWan\Team\1차 team\
├── index.html                         # 웹폰트(Noto Sans/Serif KR) 및 진입점
├── package.json                       # 55개 핵심 의존성 및 스크립트 정의
├── tsconfig.json                      # TypeScript 번들러 설정 (@/* alias)
├── vite.config.ts                     # Vite 및 Tailwind CSS v4 설정
└── src/
    ├── main.tsx                       # ReactDOM Root 진입점
    ├── App.tsx                        # 최상위 상태 관리, 라우터, 모달/드로어 제어
    ├── types.ts                       # CMS 도메인 전체 TypeScript 인터페이스
    ├── mockData.ts                    # 초기 시드 데이터 모음 (백엔드 설계 원천)
    ├── index.css                      # Tailwind v4 및 Editorial 서체 클래스
    └── components/
        ├── TopHeader.tsx              # 상단 공통 헤더 (직급 전환, 프로젝트명, 수동저장)
        ├── LeftSidebar.tsx            # 좌측 LNB 및 실시간 기사 원고 분량 계산기
        ├── auth/
        │   └── LoginView.tsx          # 사내 기자 로그인 및 페르소나 선택 화면
        ├── common/
        │   └── EditorialUI.tsx        # [보존] 디자인 시스템 공통 UI 키트 7종
        ├── dashboard/
        │   └── ProjectDashboard.tsx   # 프로젝트 목록 관리, 검색/필터, CRUD, RDBMS 설계 뷰
        ├── editor/
        │   ├── ArticleEditor.tsx      # 블록 기반 기사 작성기 (D&D 재정렬, 자동저장)
        │   ├── EditorTopBar.tsx       # 에디터 상단 보조 바 (저장 상태, 폰트 토글)
        │   ├── BlockInsertIndicator.tsx # 문단 간 '+' 삽입 인디케이터
        │   ├── MediaPickerModal.tsx   # 에디터 내 미디어 선택 모달
        │   ├── AiReviewPanel.tsx      # AI 검수 패널 (정보 오류 / 오타 / 확인 질문)
        │   └── FeedbackPanel.tsx      # 데스크·기자 협업 피드백 & 답글 패널
        ├── history/
        │   └── VersionHistoryModal.tsx # 버전 히스토리 스냅샷 조회 및 복원 모달
        ├── media/
        │   └── MediaLibraryView.tsx   # 미디어 라이브러리 (Media 탭·오른쪽 [미디어] 탭 공용)
        ├── preview/
        │   └── ArticlePreviewModal.tsx # 송고 전 독자 미리보기 (포털/지면/모바일)
        ├── publish/
        │   └── PublishModal.tsx       # 다중 채널 송고 모달
        └── settings/
            ├── SettingsView.tsx       # 환경설정 탭 래퍼
            ├── GeneralSettings.tsx    # 일반 보도 규칙 및 AI 엄격도 설정
            ├── AiApiSettings.tsx      # LLM Provider 및 모델 연동 설정
            ├── MediaSettings.tsx      # 미디어 규격 및 AI 비전 분석 설정
            └── AccountSettings.tsx    # 기자 바이라인 프로필 설정
```

---

### 제출 산출물 (docs)
- `docs/deliverables/PRESS-CMS_요구사항분석표_테스트데이터셋.xlsx`: 요구사항 분석표, 테스트 36건(판정란 포함)
- `docs/test-data/`: 테스트에 쓰는 가상 시험 자료 5개 (TXT·CSV)
- `docs/ANTIGRAVITY_작업요청서.md`: 터미널 작업(파일 정리·검사·서버 기능 배포)을 AI에게 맡기는 요청서

---

## 6. 데이터 모델 및 MySQL 스키마 계획 (10 Entities)

FastAPI + SQLAlchemy 2.0으로 구축할 정규화 RDBMS 스키마 구조입니다.

```text
users                 projects              articles              article_blocks
───────               ─────────             ─────────             ──────────────
id (PK, UUID) <────── user_id (FK)          id (PK, UUID) <────── article_id (FK)
email                 id (PK, UUID) <────── project_id (FK)       id (PK, UUID)
name                  name                  title                 block_type
role                  status                subtitle              content / text
rank                  created_at            author_id             media_url
department            updated_at            status                caption / credit
                                            created_at            position (정렬순서)

ai_reviews            feedbacks             feedback_replies      media
──────────            ─────────             ────────────────      ─────
id (PK, UUID)         id (PK, UUID) <────── feedback_id (FK)      id (PK, UUID)
article_id (FK)       article_id (FK)       id (PK, UUID)         filename
block_id              block_id (선택)       author_id             storage_key (S3)
category              author_id             content               mime_type
original_sentence     content               created_at            ai_category
proposed_change       is_resolved                                 ai_tags (JSON)
status (Pending..)    created_at
```

---

## 7. Frontend Mock Data ↔ Backend REST API 전환 맵

| 현재 React State / MockData | 향후 FastAPI 백엔드 REST API | 설명 |
| :--- | :--- | :--- |
| `MOCK_USERS` | `GET /api/v1/users/me` | JWT 기반 로그인 사용자 정보 조회 |
| `MOCK_PROJECTS` | `GET /api/v1/projects` | 사용자 소속 프로젝트 목록 조회 |
| `handleCreateProject` | `POST /api/v1/projects` | 신규 기획 프로젝트 생성 |
| `handleRenameProject` | `PUT /api/v1/projects/{id}` | 프로젝트명 및 기사 제목 수정 |
| `handleDeleteProject` | `DELETE /api/v1/projects/{id}` | 프로젝트 삭제 |
| `INITIAL_ARTICLE` | `GET /api/v1/projects/{id}/article` | 프로젝트 기사 본문 및 메타데이터 로드 |
| `handleUpdateArticle` | `PUT /api/v1/articles/{id}` | 기사 본문 및 블록 자동 저장 |
| `article.aiReviews` | `GET /api/v1/articles/{id}/ai-reviews` | AI 검수 항목 목록 조회 |
| `handleRunAiScan` | `POST /api/v1/articles/{id}/ai-reviews/scan` | 백엔드에서 Gemini API 호출하여 전수 검수 |
| `handleAcceptReview` | `PATCH /api/v1/ai-reviews/{id}` | AI 수정 제안 수락/반려 상태 갱신 |
| `article.feedbacks` | `GET /api/v1/articles/{id}/feedbacks` | 기사 블록별 피드백 목록 조회 |
| `handleAddFeedback` | `POST /api/v1/articles/{id}/feedbacks` | 신규 피드백 작성 |
| `handleAddReply` | `POST /api/v1/feedbacks/{id}/replies` | 피드백 답글 등록 |
| `MOCK_MEDIA_LIBRARY` | `GET /api/v1/media` | 미디어 에셋 라이브러리 목록 조회 |
| `handleUploadMedia` | `POST /api/v1/media/upload` | S3 업로드 및 비전 분석 메타데이터 생성 |
| `INITIAL_SNAPSHOTS` | `GET /api/v1/articles/{id}/versions` | 기사 버전 이력 조회 및 복원 |
| `handleConfirmPublish` | `POST /api/v1/articles/{id}/publish` | 부장 직급 검증 후 다중 채널 최종 송고 |

---

## 8. 단계별 개발 로드맵 (Roadmap)

```text
[Phase 0] 코드베이스 분석 및 최적화 (완료)
   │  - 불필요 패키지 6종 정리, esbuild 충돌 해결
   │  - TypeScript lint & build 100% 통과
   ▼
[Phase 1] Frontend API Client 계층 신설 (진행 예정)
   │  - Axios / TanStack Query 기반 `src/api/` 설계
   │  - Mock Data 참조부를 비동기 어댑터 패턴으로 1:1 교체
   ▼
[Phase 2] FastAPI + MySQL 백엔드 기초 구축
   │  - FastAPI 프로젝트 초기화, SQLAlchemy 2.0 모델 및 Alembic 마이그레이션
   │  - JWT 사내 인증 및 사용자/직급 권한 인가 로직 구현
   ▼
[Phase 3] 프로젝트 & 기사 에디터 Persistence 연동
   │  - 프로젝트 및 기사 블록 CRUD REST API 연결
   │  - Debounce 기반 기사 자동 저장 및 버전 스냅샷 저장
   ▼
[Phase 4] S3 미디어 스토리지 & Gemini AI 검수 파이프라인
      - Object Storage 파일 업로드 및 AI 비전 자동 태깅
      - 백엔드 프록시를 통한 AI 팩트체크/오타교정/확인질문 파이프라인 연동
      - 다중 채널 송고 권한 검증 및 감사(Audit) 로그 기록
```

---

## Project Status

- **Status**: Supabase 연동, TipTap 편집기, AI 도구 패널, 통합 미디어 라이브러리 적용 (2026-10-08)
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Vite 8 + TipTap
- **Backend / DB**: Supabase (PostgreSQL, RLS, RPC, Edge Function)
- **Media Storage**: Supabase Storage
- **AI Rule**: Review & Fact-check Assistance Only (AI Article Generation Strictly Prohibited)
