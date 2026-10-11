import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// 사내 고정 이메일 도메인 (Edge Function 전용 상수)
const COMPANY_EMAIL_DOMAIN = "pressdesk.co.kr";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      // 1. 호출자 인증 확인 (JWT 클레임에서 sub 추출)
      const callerUserId = ctx.userClaims?.sub;
      if (!callerUserId) {
        return Response.json(
          { error: "인증된 사용자 세션을 확인할 수 없습니다.", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }

      // 2. 호출자의 인사부 승인 권한 검증 (DB profiles 직접 조회)
      const { data: callerProfile, error: profileError } = await ctx.supabaseAdmin
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
      const { data: signupRequest, error: requestError } = await ctx.supabaseAdmin
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

      // 7. Auth 사용자 처리
      if (signupRequest.auth_user_id) {
        // [Case A] 이전 승인 시도에서 Auth 계정 생성 후 연결 UUID가 이미 기록된 부분 실패 상태 복구
        const { data: authUserData, error: getUserError } = await ctx.supabaseAdmin.auth.admin.getUserById(
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

        targetAuthUserId = authUserData.user.id;
        isRestoredFromPartialFailure = true;
      } else {
        // [Case B] 신규 승인 흐름: inviteUserByEmail 실행
        const userMetadata = {
          name: signupRequest.name,
          department: signupRequest.department,
          department_id: signupRequest.department_id || null,
          role: signupRequest.assigned_role,
          rank: signupRequest.assigned_rank,
          role_title: signupRequest.assigned_role_title,
          position_title_id: signupRequest.assigned_position_title_id || null,
          avatar_url: signupRequest.photo_url || null,
        };

        const { data: inviteData, error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(
          signupRequest.email,
          { data: userMetadata }
        );

        if (inviteError) {
          console.error("Auth inviteUserByEmail error:", inviteError);
          const isAlreadyRegistered = inviteError.message?.toLowerCase().includes("already registered");
          if (isAlreadyRegistered) {
            return Response.json(
              { error: "해당 이메일로 이미 등록된 다른 계정이 존재합니다.", code: "EMAIL_ALREADY_EXISTS" },
              { status: 400 }
            );
          }
          return Response.json(
            { error: "초대장 발송 및 계정 생성에 실패했습니다.", code: "INVITE_FAILED" },
            { status: 500 }
          );
        }

        targetAuthUserId = inviteData.user.id;

        // 7-1단계: 생성된 Auth UUID를 signup_requests.auth_user_id에 기록 (낙관적 락 & 0-row 검증)
        const nowIso = new Date().toISOString();
        const { data: linkedRequest, error: linkError } = await ctx.supabaseAdmin
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
            { error: "계정 초대는 완료되었으나 연결 정보 저장에 실패했습니다. 관리자에게 문의하세요.", code: "PARTIAL_FAILURE_LINK" },
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
      const { data: approvedRequest, error: approveError } = await ctx.supabaseAdmin
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
          { error: "계정 초대는 완료되었으나 승인 상태 반영에 실패했습니다. 다시 승인을 시도해주세요.", code: "PARTIAL_FAILURE_STATUS" },
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
          : "가입 신청이 승인되었으며 비밀번호 설정 초대장이 발송되었습니다.",
        userId: targetAuthUserId,
      });
    } catch (err) {
      console.error("Unhandled exception in approve-signup function:", err);
      return Response.json(
        { error: "가입 승인 처리 중 서버 오류가 발생했습니다.", code: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      );
    }
  }),
};
