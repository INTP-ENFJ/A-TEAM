# Antigravity AI 작업 요청서 (PRESS-CMS) — 사이트 올리기(Render)

이 문서는 사용자가 비개발자라서, 터미널 작업을 대신 실행해 달라고 요청하는 문서입니다.
작업이 끝나면 **쉬운 한국어로, 전문용어 없이** 결과를 보고해 주세요.
사용자는 사이트가 **Render**에 있을 것으로 예상하고 있지만 확인된 것은 아닙니다. 아래 2단계에서 먼저 확인해 주세요.

## 지켜 주세요
- 프로젝트 폴더(`C:\ShinJaeWan\Team\team`)에서만 작업합니다.
- 비밀값(API 키, `AI_KEY_ENCRYPTION_SECRET`, `.env.local`의 내용)은 출력하거나 올리지 않습니다. `.env*` 파일과 Supabase 비밀값은 건드리지 않습니다.
- `npx supabase db push`, `supabase db reset`처럼 데이터베이스를 바꾸는 명령은 **실행하지 않습니다**. (SQL은 사용자가 Supabase 화면에서 직접 실행합니다.)
- 소스 코드는 오류가 나서 꼭 고쳐야 할 때만 최소한으로 고치고, 무엇을 왜 고쳤는지 보고합니다.
- 올리기(푸시) 전에 무엇이 올라가는지 반드시 사용자에게 보여 주고, 사용자가 "올려"라고 답한 뒤에만 푸시합니다.

## 1단계: 정리하고 검사하기
1) 시험용 파일 폴더가 있으면 지웁니다. (이미 없으면 넘어갑니다.)
```powershell
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue public\_tmp_test_audio
```
2) 코드 검사와 빌드:
```powershell
npm run lint
npm run build
```
- 둘 다 통과해야 합니다. 실패하면 오류 메시지를 읽고 최소한으로 고친 뒤 다시 실행합니다.

## 2단계: 사이트가 어디에 어떻게 연결되어 있는지 확인 (읽기만, 고치지 않음)
```powershell
git rev-parse --show-toplevel
git remote -v
git status --short
git log --oneline -5
```
- 폴더 안에 `.git`이 없으면 상위 폴더(`C:\ShinJaeWan\Team`)에 있는지 `git rev-parse --show-toplevel`로 확인합니다.
- git이 전혀 없으면 여기서 멈추고 "git 저장소가 없음"이라고 보고합니다. (임의로 새로 만들지 않습니다.)
- 원격 주소(`origin`)가 있으면 GitHub 주소만 보고합니다. (토큰이 주소에 들어 있으면 가리고 보고합니다.)
- Render 설정 파일(`render.yaml`)이 있는지도 알려 주세요.

## 3단계: 올릴 목록을 사용자에게 보여 주기
`git status --short` 결과를 아래처럼 나눠 보여 줍니다.
- 올라가도 되는 것: `src\`, `supabase\migrations\`, `supabase\functions\`, `docs\`, `README.md`, `package*.json` 등 소스와 문서
- **올리면 안 되는 것**: `.env.local`, `.env`, `node_modules\`, `dist\`, `_backup_*\`, `scratch\`, `public\_tmp_test_audio\`
  - 이런 항목이 목록에 보이면 올리지 말고 `.gitignore`에 이미 들어 있는지만 확인해 알려 주세요.

## 4단계: 사용자가 "올려"라고 한 뒤에만
```powershell
git add -A
git status --short
git commit -m "가이드 개편, 알림·인사 관리 기능, 녹음 받아쓰기 위치 개선"
git push
```
- `git add -A` 뒤 `git status`에서 3단계의 "올리면 안 되는 것"이 포함돼 있으면 커밋하지 말고 중단하여 보고합니다.
- 푸시가 막히면(권한·로그인) 오류 문구만 그대로 보고합니다. 비밀번호나 토큰을 새로 만들지 않습니다.

## 5단계: Render 확인 (사용자 화면에서)
Render에 연결되어 있으면 푸시 뒤 몇 분 안에 자동으로 새로 만들어집니다. 사용자에게 다음을 안내합니다.
1. Render 사이트(dashboard.render.com)에서 해당 사이트의 **Events**에 새 배포가 시작되었는지 봅니다.
2. 실패하면 **Logs**의 빨간 문구를 알려 줍니다.
3. 설정이 맞는지 확인할 값 (Static Site 기준):
   - Build Command: `npm install && npm run build`
   - Publish Directory: `dist`
   - Environment에 `VITE_`로 시작하는 Supabase 주소·공개키 값이 들어 있어야 합니다. (값은 보고하지 않고 "있음/없음"만 알려 주세요.)

## 6단계: 결과 보고 (사용자에게 쉬운 말로)
1. 시험용 파일 폴더 삭제: 했음 / 원래 없었음
2. 코드 검사(lint): 통과 / 실패
3. 빌드(build): 통과 / 실패
4. git 저장소: 있음(주소) / 없음
5. 올린 내용: (몇 개 파일) / 아직 안 올림
6. 마지막에 이 문장을 그대로 덧붙이기:
   "남은 일: Supabase SQL Editor에서 `20261008200000`, `20261008210000`, `20261008220000`으로 시작하는 마이그레이션 파일 3개를 순서대로 실행했는지 확인해 주세요. (이미 실행했다면 다시 실행해도 괜찮습니다.)"
