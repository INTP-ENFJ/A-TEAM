import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 사내 고정 이메일 도메인 (Edge Function 전용 상수)
const COMPANY_EMAIL_DOMAIN = "pressdesk.co.kr";

// 임시 비밀번호 생성 (헷갈리는 글자 0/O/1/l/I 제외, 영문 대·소문자와 숫자를 반드시 포함, 12자)
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
      // 1. 호출자 인증 확인 (JWT 클레임에서 sub 추출)
      const callerUserId = (ctx.userClaims?.id ?? (ctx as any).jwtClaims?.sub);
      if (!callerUserId) {
        return Response.json(
          { error: "인증된 사용자 세션을 확인할 수 없습니다.", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }

      // 2. 호출자의 인사부 승인 권한 검증 (DB profiles 직접 조회)
      const { data: callerProfile, error: profileError } = await admin
        .from("profiles")
        .select("department, can_manage_signups")
        .eq("id", callerUserId)
        .single();

      if (profileError || !callerProfile) {
        console.error("Caller profile fetch error:", profileError);
        return Response.json(
          { error: "호출자의 프로필 정보를 확인할 수 없습니다.", code: "FORBIDDEN" },
          { status: 403 }
        );
      }

      if (callerProfile.department !== "인사부" || callerProfile.can_manage_signups !== true) {
        return Response.json(
          { error: "가입 승인 권한이 없습니다. (인사부 승인 권한 필요)", code: "FORBIDDEN" },
          { status: 403 }
        );
      }

      // 3. 요청 본문 파싱 ({ signupRequestId }만 수신)
      let body: { signupRequestId?: string };
      try {
        body = await req.json();
      } catch (jsonErr) {
        console.error("Invalid JSON body:", jsonErr);
        return Response.json(
          { error: "잘못된 요청 형식입니다.", code: "INVALID_REQUEST" },
          { status: 400 }
        );
      }

      const { signupRequestId } = body;
      if (!signupRequestId) {
        return Response.json(
          { error: "signupRequestId가 필요합니다.", code: "INVALID_REQUEST" },
          { status: 400 }
        );
      }

      // 4. 가입 신청 정보 DB 조회
      const { data: signupRequest, error: requestError } = await admin
        .from("signup_requests")
        .select("*")
        .eq("id", signupRequestId)
        .single();

      if (requestError || !signupRequest) {
        console.error("Signup request fetch error:", requestError);
        return Response.json(
          { error: "가입 신청 정보를 찾을 수 없습니다.", code: "REQUEST_NOT_FOUND" },
          { status: 404 }
        );
      }

      // 5. 신청 상태 검증 (반드시 pending이어야 함)
      if (signupRequest.status !== "pending") {
        return Response.json(
          { error: "이미 처리가 완료되었거나 반려된 신청 건입니다.", code: "ALREADY_PROCESSED" },
          { status: 400 }
        );
      }

      // 5-1. 회사 이메일 도메인 서버 측 엄격 검증 (서브도메인/우회 도메인 공격 방어)
      const rawEmail = signupRequest.email?.trim().toLowerCase() || "";
      const emailParts = rawEmail.split("@");
      if (emailParts.length !== 2 || emailParts[1] !== COMPANY_EMAIL_DOMAIN) {
        console.error("Rejected signup request with invalid email domain:", {
          requestId: signupRequest.id,
          email: signupRequest.email,
        });
        return Response.json(
          { 
            error: `허용되지 않은 이메일 도메인입니다. (${COMPANY_EMAIL_DOMAIN} 전용 계정만 승인 가능)`, 
            code: "INVALID_EMAIL_DOMAIN" 
          },
          { status: 400 }
        );
      }

      // 6. 인사부 필수 배정 정보 검증
      if (
        !signupRequest.assigned_rank ||
        !signupRequest.assigned_role ||
        !signupRequest.assigned_role_title
      ) {
        return Response.json(
          { error: "직급, 역할, 직책이 모두 배정되어야 승인할 수 있습니다.", code: "INCOMPLETE_ASSIGNMENT" },
          { status: 400 }
        );
      }

      let targetAuthUserId: string | null = null;
      let isRestoredFromPartialFailure = false;
      // 승인 시 인사부에 한 번만 보여 주는 임시 비밀번호 (저장하지 않음)
      const temporaryPassword = generateTempPassword();
      // 신청 때 이미 비밀번호를 받은 계정이면 새 비밀번호를 만들지 않는다
      let needTempPassword = true;

      // 7. Auth 사용자 처리
      if (signupRequest.auth_user_id) {
        // [Case A] 이전 승인 시도에서 Auth 계정 생성 후 연결 UUID가 이미 기록된 부분 실패 상태 복구
        const { data: authUserData, error: getUserError } = await admin.auth.admin.getUserById(
          signupRequest.auth_user_id
        );

        if (getUserError || !authUserData?.user) {
          console.error("Linked Auth user not found in Supabase Auth:", getUserError, {
            linkedAuthUserId: signupRequest.auth_user_id,
          });
          return Response.json(
            { error: "연결된 Auth 계정 정보를 확인할 수 없습니다. 관리자에게 문의하세요.", code: "INVALID_LINKED_AUTH_USER" },
            { status: 500 }
          );
        }

        // Auth 계정의 이메일과 신청서 이메일이 정확히 일치하는지 검증
        if (authUserData.user.email?.toLowerCase() !== signupRequest.email.toLowerCase()) {
          console.error("Email mismatch between signup_requests and linked Auth user:", {
            requestEmail: signupRequest.email,
            authEmail: authUserData.user.email,
          });
          return Response.json(
            { error: "연결된 계정과 가입 신청 이메일이 일치하지 않습니다.", code: "AUTH_USER_EMAIL_MISMATCH" },
            { status: 400 }
          );
        }

        const approvalMark = (authUserData.user.app_metadata as Record<string, unknown> | undefined)?.approval;
        if (approvalMark === "pending" || approvalMark === "approved") {
          // [신청 때 이미 계정과 비밀번호를 받은 경우] 비밀번호는 그대로 두고 승인 표식만 바꾼다
          const { error: approveMarkError } = await admin.auth.admin.updateUserById(
            authUserData.user.id,
            { app_metadata: { ...(authUserData.user.app_metadata || {}), approval: "approved" } }
          );
          if (approveMarkError) {
            console.error("Auth updateUserById (approval mark) error:", approveMarkError.message);
            return Response.json(
              { error: "계정을 승인 상태로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "APPROVAL_MARK_FAILED" },
              { status: 500 }
            );
          }
          needTempPassword = false;
        } else {
          // [이전 방식으로 만든 계정] 이전에 만든 임시 비밀번호는 알 수 없으므로 새로 발급해 덮어쓴다
          const { error: resetPwError } = await admin.auth.admin.updateUserById(
            authUserData.user.id,
            {
              password: temporaryPassword,
              user_metadata: { ...(authUserData.user.user_metadata || {}), must_change_password: true },
            }
          );
          if (resetPwError) {
            console.error("Auth updateUserById (temp password) error:", resetPwError.message);
            return Response.json(
              { error: "임시 비밀번호를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "TEMP_PASSWORD_FAILED" },
              { status: 500 }
            );
          }
        }

        targetAuthUserId = authUserData.user.id;
        isRestoredFromPartialFailure = needTempPassword;
      } else {
        // [Case B] 신규 승인 흐름: 이메일을 보내지 않고 임시 비밀번호로 계정을 바로 만든다
        // (사내 도메인 주소는 메일을 받을 수 없으므로 초대 메일 방식을 쓰지 않는다)
        const userMetadata = {
          name: signupRequest.name,
          department: signupRequest.department,
          department_id: signupRequest.department_id || null,
          role: signupRequest.assigned_role,
          rank: signupRequest.assigned_rank,
          role_title: signupRequest.assigned_role_title,
          position_title_id: signupRequest.assigned_position_title_id || null,
          avatar_url: signupRequest.photo_url || null,
          must_change_password: true,
        };

        const { data: inviteData, error: inviteError } = await admin.auth.admin.createUser({
          email: signupRequest.email,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: userMetadata,
        });

        if (inviteError || !inviteData?.user) {
          console.error("Auth createUser error:", inviteError?.message);
          const lowered = inviteError?.message?.toLowerCase() || "";
          const isAlreadyRegistered = lowered.includes("already") && lowered.includes("registered");
          if (isAlreadyRegistered) {
            return Response.json(
              { error: "해당 이메일로 이미 등록된 다른 계정이 존재합니다.", code: "EMAIL_ALREADY_EXISTS" },
              { status: 400 }
            );
          }
          return Response.json(
            { error: "계정 생성에 실패했습니다.", code: "INVITE_FAILED" },
            { status: 500 }
          );
        }

        targetAuthUserId = inviteData.user.id;

        // 7-1단계: 생성된 Auth UUID를 signup_requests.auth_user_id에 기록 (낙관적 락 & 0-row 검증)
        const nowIso = new Date().toISOString();
        const { data: linkedRequest, error: linkError } = await admin
          .from("signup_requests")
          .update({
            auth_user_id: targetAuthUserId,
            updated_at: nowIso,
          })
          .eq("id", signupRequestId)
          .eq("status", "pending")
          .is("auth_user_id", null)
          .select("id, auth_user_id, status")
          .maybeSingle();

        if (linkError) {
          console.error("CRITICAL: Failed to link auth_user_id to signup_requests:", linkError, {
            signupRequestId,
            authUserId: targetAuthUserId,
          });
          return Response.json(
            { error: "계정 생성은 완료되었으나 연결 정보 저장에 실패했습니다. 다시 승인을 시도해주세요.", code: "PARTIAL_FAILURE_LINK" },
            { status: 500 }
          );
        }

        // 0-row 검증: 동시 요청 등으로 인해 실제로 수정된 row가 없는 경우
        if (!linkedRequest) {
          console.error("CONCURRENT_UPDATE: 0 rows affected when linking auth_user_id:", {
            signupRequestId,
            authUserId: targetAuthUserId,
          });
          return Response.json(
            { error: "다른 요청에 의해 가입 신청 상태가 이미 변경되었습니다.", code: "CONCURRENT_UPDATE" },
            { status: 409 }
          );
        }
      }

      // 8. 최종 승인 상태 업데이트 (status = 'approved', 0-row 검증)
      const finalNowIso = new Date().toISOString();
      const { data: approvedRequest, error: approveError } = await admin
        .from("signup_requests")
        .update({
          status: "approved",
          reviewed_by: callerUserId,
          reviewed_at: finalNowIso,
          updated_at: finalNowIso,
        })
        .eq("id", signupRequestId)
        .eq("status", "pending")
        .eq("auth_user_id", targetAuthUserId)
        .select("id, auth_user_id, status")
        .maybeSingle();

      if (approveError) {
        console.error("CRITICAL: Failed to update status to approved:", approveError, {
          signupRequestId,
          authUserId: targetAuthUserId,
        });
        return Response.json(
          { error: "계정 생성은 완료되었으나 승인 상태 반영에 실패했습니다. 다시 승인을 시도해주세요.", code: "PARTIAL_FAILURE_STATUS" },
          { status: 500 }
        );
      }

      // 0-row 검증: 최종 approved 반영 행이 0개인 경우
      if (!approvedRequest) {
        console.error("CONCURRENT_UPDATE: 0 rows affected when updating to approved:", {
          signupRequestId,
          authUserId: targetAuthUserId,
        });
        return Response.json(
          { error: "신청서 상태 변경에 실패했습니다. (이미 처리되었거나 상태가 변경됨)", code: "CONCURRENT_UPDATE" },
          { status: 409 }
        );
      }

      // 9. 성공 응답 반환
      return Response.json({
        success: true,
        message: isRestoredFromPartialFailure
          ? "이전 미완료 건을 포함하여 가입 승인 처리가 정상 복구 및 완료되었습니다."
          : needTempPassword
            ? "가입 신청이 승인되었습니다. 임시 비밀번호를 신청자에게 직접 전달해 주세요."
            : "가입 신청이 승인되었습니다. 이제 모든 기능을 사용할 수 있습니다.",
        userId: targetAuthUserId,
        // 새로 만든 계정일 때만 전달 (신청 때 비밀번호를 이미 받은 경우에는 없음)
        temporaryPassword: needTempPassword ? temporaryPassword : undefined,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      console.error("Unhandled exception in approve-signup function:", err);
      return Response.json(
        {
          error: "가입 승인 처리 중 서버 오류가 발생했습니다." +
            (err instanceof Error ? ` (원인: ${err.message.slice(0, 200)})` : ""),
          code: "INTERNAL_SERVER_ERROR",
        },
        { status: 500 }
      );
    }
  }),
};
