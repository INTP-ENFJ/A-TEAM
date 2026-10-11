# Antigravity AI 작업 요청서 (PRESS-CMS)

이 문서는 사용자가 비개발자라서, 터미널 작업을 대신 실행해 달라고 요청하는 문서입니다.
작업이 끝나면 **쉬운 한국어로, 전문용어 없이** 결과를 보고해 주세요.

## 지켜 주세요
- 프로젝트 폴더(`C:\ShinJaeWan\Team\team`)에서만 작업합니다.
- 비밀값(API 키, `AI_KEY_ENCRYPTION_SECRET`)은 출력하거나 파일에 쓰지 않습니다. `.env`와 Supabase 비밀값은 건드리지 않습니다.
- `npx supabase db push`, `supabase db reset`처럼 데이터베이스를 바꾸는 명령은 **실행하지 않습니다**. (SQL은 사용자가 Supabase 화면에서 직접 실행합니다.)
- 소스 코드는 오류가 나서 꼭 고쳐야 할 때만 최소한으로 고치고, 무엇을 왜 고쳤는지 보고합니다.

## 1단계: 안 쓰는 파일 지우기
아래를 PowerShell에서 실행합니다. 이미 없는 파일은 그냥 넘어가도 됩니다.

```powershell
Remove-Item -ErrorAction SilentlyContinue `
  src\components\media\MediaLibraryDrawer.tsx, `
  src\components\editor\InfographicModal.tsx, `
  src\components\editor\DraftRatingBox.tsx, `
  src\services\draftRatingService.ts, `
  supabase\migrations\20261008170000_ai_draft_ratings.sql
```

## 2단계: 코드 검사와 빌드
```powershell
npm run lint
npm run build
```
- 둘 다 통과해야 합니다.
- 실패하면 오류 메시지를 읽고, 위에서 지운 파일을 가리키는 코드가 남아 있는지 먼저 확인해 최소한으로 고친 뒤 다시 실행합니다.

## 3단계: 서버 기능 9개 올리기 (한 줄씩, 순서대로)
```powershell
npx supabase functions deploy manage-ai-key
npx supabase functions deploy review-article-content
npx supabase functions deploy analyze-media-image
npx supabase functions deploy ai-interview-draft
npx supabase functions deploy extract-infographic-data
npx supabase functions deploy organize-raw-data
npx supabase functions deploy fetch-web-source
npx supabase functions deploy transcribe-audio
npx supabase functions deploy generate-image
```
- 각 명령 끝에 `Deployed Functions on project ...`가 나오면 성공입니다. "Docker is not running" 경고는 무시해도 됩니다.
- 하나라도 실패하면 오류 메시지를 보여 주고, 같은 명령을 한 번만 다시 시도합니다.

올린 뒤 확인합니다.
```powershell
npx supabase functions list
```
위 9개가 모두 `ACTIVE`로 보여야 합니다.

## 3-2단계: 새로 만든 파일이 있는지 확인
아래 3개 파일이 있는지 확인하고 있으면 "있음", 없으면 "없음"이라고만 보고합니다. (고치지 않습니다.)
- `src\components\settings\GoogleCloudKeyBox.tsx`
- `supabase\migrations\20261008190000_allow_googlecloud_key.sql`
- `docs\deliverables\PRESS-CMS_통합현황표.xlsx`

## 4단계: 결과 보고 (사용자에게 쉬운 말로)
다음 형식으로 알려 주세요.
1. 지운 파일: (몇 개)
2. 코드 검사(lint): 통과 / 실패
3. 빌드(build): 통과 / 실패
4. 서버 기능 9개 중 성공한 개수와, 실패한 것의 이름·이유 한 줄
5. 마지막에 이 문장을 그대로 덧붙이기:
   "남은 일: Supabase 사이트의 SQL Editor에서 아래 두 파일의 내용을 하나씩 복사해 붙여 넣고 Run을 눌러 주세요. (1) `supabase/migrations/20261008180000_ai_call_logs.sql` (2) `supabase/migrations/20261008190000_allow_googlecloud_key.sql` (이미 실행했다면 다시 실행해도 괜찮습니다.)"
