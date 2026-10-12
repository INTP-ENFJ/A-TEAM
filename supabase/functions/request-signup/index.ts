import { createClient } from "jsr:@supabase/supabase-js@2";

// 가입 신청 접수 서버 기능 (로그인 전에 호출됨)
// - 신청과 동시에 "승인 대기" 계정을 만들고 임시 비밀번호를 한 번만 돌려준다.
// - 승인 대기 계정은 화면에서 읽기만 가능하며, 인사부 승인 후 모든 기능이 열린다.
// - 직급·역할은 신청자가 정할 수 없고, 항상 가장 낮은 기본값(기자)으로 만든다.
// - 임시 비밀번호는 저장하거나 로그에 남기지 않는다.

const COMPANY_EMAIL_DOMAIN = "pressdesk.co.kr";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  while (chars.length < 12) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const fail = (error: string, code: string, status = 400) =>
    Response.json({ success: false, error, code }, { status, headers: corsHeaders });

  try {
    if (req.method !== "POST") return fail("POST 메서드만 지원합니다.", "METHOD_NOT_ALLOWED", 405);

    let body: { name?: string; departmentId?: string; loginId?: string };
    try {
      body = await req.json();
    } catch {
      return fail("잘못된 요청 형식입니다.", "INVALID_REQUEST");
    }

    // 1. 입력 검증
    const name = (body.name || "").trim();
    if (!name || name.length > 50) return fail("성명을 올바르게 입력해 주세요.", "INVALID_NAME");

    let loginId = (body.loginId || "").trim().toLowerCase();
    if (loginId.includes("@")) {
      const parts = loginId.split("@");
      if (parts[parts.length - 1] !== COMPANY_EMAIL_DOMAIN) {
        return fail("사내 이메일 계정만 사용할 수 있습니다.", "INVALID_EMAIL_DOMAIN");
      }
      loginId = parts.slice(0, -1).join("@");
    }
    if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(loginId) || loginId.length > 64) {
      return fail("아이디는 영문 소문자, 숫자, 마침표(.), 하이픈(-), 밑줄(_)만 사용할 수 있습니다.", "INVALID_LOGIN_ID");
    }
    const departmentId = (body.departmentId || "").trim();
    if (!departmentId) return fail("소속 부서를 선택해 주세요.", "INVALID_DEPARTMENT");

    const email = `${loginId}@${COMPANY_EMAIL_DOMAIN}`;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 2. 부서 확인 (사용 중인 부서만, 이름은 서버에서 읽는다)
    const { data: dept } = await admin
      .from("departments")
      .select("id, name")
      .eq("id", departmentId)
      .eq("is_active", true)
      .maybeSingle();
    if (!dept) return fail("선택한 부서를 찾을 수 없습니다.", "INVALID_DEPARTMENT");

    // 3. 이미 접수된 신청인지 확인
    const { data: existing } = await admin
      .from("signup_requests")
      .select("id")
      .eq("email", email)
      .limit(1);
    if (existing && existing.length > 0) {
      return fail("이미 가입 신청이 접수된 아이디입니다.", "ALREADY_REQUESTED", 409);
    }

    // 4. 승인 대기 계정 만들기 (직급·역할은 가장 낮은 기본값)
    const temporaryPassword = generateTempPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        name,
        department: dept.name,
        department_id: dept.id,
        role: "reporter",
        rank: "reporter",
        // 프로필의 직함 칸은 비워 둘 수 없어서 임시로 기본 직함을 넣는다 (승인 때 인사부가 정한 직책으로 바뀜)
        role_title: "평기자",
        must_change_password: true,
      },
      // app_metadata는 본인이 바꿀 수 없다. 인사부 승인 시에만 'approved'로 바뀐다.
      app_metadata: { approval: "pending" },
    });
    if (createError || !created?.user) {
      const registered = createError?.message?.toLowerCase().includes("already");
      if (registered) return fail("이미 사용 중인 아이디입니다.", "ID_TAKEN", 409);
      console.error("createUser error:", createError?.message);
      return fail("가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", "CREATE_FAILED", 500);
    }

    // 5. 신청서 기록 (실패하면 방금 만든 계정을 되돌린다)
    const { error: insertError } = await admin.from("signup_requests").insert({
      name,
      department: dept.name,
      department_id: dept.id,
      email,
      photo_url: null,
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      auth_user_id: created.user.id,
    });
    if (insertError) {
      console.error("signup_requests insert error:", insertError.code);
      await admin.auth.admin.deleteUser(created.user.id);
      if (insertError.code === "23505") {
        return fail("이미 가입 신청이 접수된 아이디입니다.", "ALREADY_REQUESTED", 409);
      }
      return fail("가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", "INSERT_FAILED", 500);
    }

    return Response.json(
      { success: true, email, temporaryPassword },
      { headers: { ...corsHeaders, "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Unhandled exception in request-signup:", err instanceof Error ? err.message : "unknown");
    return fail("가입 신청 중 서버 오류가 발생했습니다.", "INTERNAL_SERVER_ERROR", 500);
  }
});
