import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 사내 고정 이메일 도메인
const COMPANY_EMAIL_DOMAIN = "pressdesk.co.kr";

// 임시 비밀번호 생성 (헷갈리는 글자 제외, 영문 대·소문자와 숫자 포함, 12자)
// 보안: 암호학적 난수만 사용하며, 비밀번호는 로그에 남기지 않는다.
function randomIndex(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const chars = [
    upper[randomIndex(upper.length)],
    lower[randomIndex(lower.length)],
    digits[randomIndex(digits.length)],
  ];
  while (chars.length < 12) {
    chars.push(all[randomIndex(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      // 서버 전용 관리자 연결 (이 프로젝트에 설정된 서비스 키를 직접 사용)
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // 1. 호출자 확인
      const callerUserId = (ctx.userClaims?.id ?? (ctx as any).jwtClaims?.sub);
      if (!callerUserId) {
        return Response.json(
          { error: "인증된 사용자 세션을 확인할 수 없습니다.", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }

      // 2. 인사부 관리자 권한 확인 (가입 승인과 같은 기준)
      const { data: callerProfile, error: profileError } = await admin
        .from("profiles")
        .select("department, can_manage_signups")
        .eq("id", callerUserId)
        .single();

      if (profileError || !callerProfile) {
        return Response.json(
          { error: "호출자의 프로필 정보를 확인할 수 없습니다.", code: "FORBIDDEN" },
          { status: 403 }
        );
      }
      if (callerProfile.department !== "인사부" || callerProfile.can_manage_signups !== true) {
        return Response.json(
          { error: "임시 비밀번호를 발급할 권한이 없습니다. (인사부 관리자 권한 필요)", code: "FORBIDDEN" },
          { status: 403 }
        );
      }

      // 3. 요청 본문 ({ requestId } 만 받는다)
      let body: { requestId?: string };
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "잘못된 요청 형식입니다.", code: "INVALID_REQUEST" }, { status: 400 });
      }
      const requestId = body.requestId;
      if (!requestId) {
        return Response.json({ error: "requestId가 필요합니다.", code: "INVALID_REQUEST" }, { status: 400 });
      }

      // 4. 분실 신고 조회 (처리 대기 건만)
      const { data: resetRequest, error: requestError } = await admin
        .from("password_reset_requests")
        .select("id, name, login_id, company_email, status")
        .eq("id", requestId)
        .single();

      if (requestError || !resetRequest) {
        return Response.json({ error: "분실 신고를 찾을 수 없습니다.", code: "REQUEST_NOT_FOUND" }, { status: 404 });
      }
      if (resetRequest.status !== "pending") {
        return Response.json({ error: "이미 처리 완료된 신고입니다.", code: "ALREADY_PROCESSED" }, { status: 400 });
      }

      // 5. 사내 이메일 확정 (사내 도메인만 허용)
      const email = (resetRequest.company_email || `${resetRequest.login_id}@${COMPANY_EMAIL_DOMAIN}`)
        .trim()
        .toLowerCase();
      if (email.split("@")[1] !== COMPANY_EMAIL_DOMAIN) {
        return Response.json({ error: "사내 이메일 계정만 처리할 수 있습니다.", code: "INVALID_EMAIL_DOMAIN" }, { status: 400 });
      }

      // 6. 해당 직원의 로그인 계정 찾기
      let targetUser: { id: string; user_metadata?: Record<string, unknown> } | null = null;
      for (let page = 1; page <= 10 && !targetUser; page++) {
        const { data: listData, error: listError } = await admin.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (listError) {
          console.error("listUsers error:", listError.message);
          return Response.json({ error: "계정을 조회하지 못했습니다.", code: "LOOKUP_FAILED" }, { status: 500 });
        }
        const found = listData.users.find((u) => u.email?.toLowerCase() === email);
        if (found) targetUser = { id: found.id, user_metadata: found.user_metadata };
        if (listData.users.length < 200) break;
      }
      if (!targetUser) {
        return Response.json(
          { error: "해당 이메일의 계정을 찾을 수 없습니다. 아이디를 다시 확인해 주세요.", code: "USER_NOT_FOUND" },
          { status: 404 }
        );
      }

      // 7. 비활성화된 계정은 발급하지 않는다
      const { data: targetProfile } = await admin
        .from("profiles")
        .select("is_active")
        .eq("id", targetUser.id)
        .maybeSingle();
      if (targetProfile && targetProfile.is_active === false) {
        return Response.json(
          { error: "비활성화된 계정입니다. 먼저 직원 관리에서 다시 사용 설정을 해 주세요.", code: "ACCOUNT_INACTIVE" },
          { status: 400 }
        );
      }

      // 8. 임시 비밀번호로 교체 (첫 로그인 후 변경 안내 표시용 표식 포함)
      const temporaryPassword = generateTempPassword();
      const { error: updateError } = await admin.auth.admin.updateUserById(targetUser.id, {
        password: temporaryPassword,
        user_metadata: { ...(targetUser.user_metadata || {}), must_change_password: true },
      });
      if (updateError) {
        console.error("updateUserById error:", updateError.message);
        return Response.json(
          { error: "임시 비밀번호를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "TEMP_PASSWORD_FAILED" },
          { status: 500 }
        );
      }

      return Response.json(
        {
          success: true,
          message: "임시 비밀번호를 발급했습니다. 본인 확인 후 직접 전달해 주세요.",
          name: resetRequest.name,
          email,
          temporaryPassword,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      console.error("Unhandled exception in hr-reset-password:", err instanceof Error ? err.message : "unknown");
      return Response.json(
        { error: "임시 비밀번호 발급 중 서버 오류가 발생했습니다.", code: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      );
    }
  }),
};
