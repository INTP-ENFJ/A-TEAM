import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 웹 주소의 기사·자료 글을 가져와 "참고 자료"로 돌려주는 서버 기능 (AI를 쓰지 않음)
// - 공개 웹 주소만 허용(내부망 차단), 사이트의 robots.txt가 막은 곳은 가져오지 않음
// - 가져온 글은 저장하지 않고 화면으로만 돌려줌. 출처 주소와 수집 시각을 함께 줌
import { LLM_CORS_HEADERS } from "../_shared/llm.ts";
import { parsePublicWebUrl, isPrivateIp, isBlockedByRobots, extractPage, detectCharset } from "../_shared/webText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": LLM_CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_AGENT = "PressCMS-ResearchBot/1.0 (newsroom research; respects robots.txt)";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 30000;
const MAX_REDIRECTS = 3;

class WebError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 이름이 내부 주소로 풀리는지 확인 (풀이를 지원하지 않는 환경이면 문자열 검사만 한다) */
async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIp(h)) throw new WebError("내부 주소는 가져올 수 없습니다.");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return;
  try {
    const lookups = await Promise.allSettled([Deno.resolveDns(h, "A"), Deno.resolveDns(h, "AAAA")]);
    const ips: string[] = [];
    for (const r of lookups) if (r.status === "fulfilled") ips.push(...(r.value as string[]));
    if (ips.length === 0) throw new WebError("주소를 찾지 못했습니다. 주소를 다시 확인해 주세요.");
    if (ips.some(isPrivateIp)) throw new WebError("내부 주소는 가져올 수 없습니다.");
  } catch (e) {
    if (e instanceof WebError) throw e;
    // 이름 풀이를 쓸 수 없는 환경: 위의 문자열 검사만 적용
  }
}

async function fetchChecked(url: URL, accept: string, timeoutMs: number): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHost(current.hostname);
    const res = await fetch(current, {
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "ko,en;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new WebError("주소가 다른 곳으로 옮겨졌지만 새 주소를 알 수 없습니다.");
      const next = parsePublicWebUrl(new URL(loc, current).toString());
      if (!next) throw new WebError("옮겨진 주소를 가져올 수 없습니다.");
      current = next;
      continue;
    }
    (res as any).finalUrl = current;
    return res;
  }
  throw new WebError("주소가 여러 번 옮겨져 가져오지 못했습니다.");
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new WebError("페이지가 너무 커서 가져올 수 없습니다. (2MB 초과)");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status, headers: corsHeaders });

  try {
    if (req.method !== "POST") return fail("POST 메서드만 지원합니다.", 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("인증 토큰이 필요합니다.", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return fail("유효하지 않은 사용자 세션입니다.", 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("department, role").eq("id", user.id).single();
    if (!profile || profile.department === "인사부" || profile.role === "hr_admin") {
      return fail("이 계정은 웹 자료 가져오기를 사용할 수 없습니다.", 403);
    }

    let body: { url?: string } = {};
    try { body = await req.json(); } catch { return fail("잘못된 요청입니다."); }
    const target = parsePublicWebUrl(String(body.url || ""));
    if (!target) return fail("올바른 웹 주소(http:// 또는 https://)를 입력해 주세요. 내부 주소는 쓸 수 없습니다.");

    // 1. robots.txt 확인: 사이트가 자동 수집을 막은 곳은 가져오지 않음
    try {
      const robotsRes = await fetchChecked(new URL("/robots.txt", target.origin), "text/plain", 5000);
      if (robotsRes.ok) {
        const txt = new TextDecoder().decode(await readLimited(robotsRes, 200 * 1024));
        if (isBlockedByRobots(txt, target.pathname + target.search, USER_AGENT)) {
          return fail("이 사이트가 자동 수집을 허용하지 않아 가져올 수 없습니다. 기사를 직접 읽고 필요한 내용을 메모에 적어 주세요.", 403);
        }
      } else {
        await robotsRes.body?.cancel();
      }
    } catch (e) {
      if (e instanceof WebError && e.status === 403) throw e;
      // robots.txt가 없거나 읽지 못하면 허용으로 본다
    }

    // 2. 페이지 가져오기
    let res: Response;
    try {
      res = await fetchChecked(target, "text/html,application/xhtml+xml,text/plain", 20000);
    } catch (e) {
      if (e instanceof WebError) return fail(e.message, e.status);
      return fail("페이지에 연결하지 못했습니다. 주소를 확인하거나 잠시 후 다시 시도해 주세요.", 502);
    }
    if (!res.ok) {
      await res.body?.cancel();
      return fail(`페이지를 가져오지 못했습니다. (사이트 응답 ${res.status})`, 502);
    }
    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
      await res.body?.cancel();
      return fail("글로 된 웹 페이지만 가져올 수 있습니다. (PDF·이미지·영상은 불가)");
    }
    const bytes = await readLimited(res, MAX_BYTES);
    let charset = detectCharset(ctype, bytes);
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      charset = "utf-8";
      html = new TextDecoder("utf-8").decode(bytes);
    }

    const page = /text\/plain/i.test(ctype)
      ? { title: "", siteName: "", publishedAt: "", text: html.slice(0, MAX_CHARS) }
      : extractPage(html, MAX_CHARS);
    if (page.text.trim().length < 50) {
      return fail("페이지에서 읽을 만한 글을 찾지 못했습니다. (로그인이 필요하거나 화면이 자바스크립트로 그려지는 사이트일 수 있습니다)");
    }

    const finalUrl: URL = (res as any).finalUrl || target;
    return Response.json(
      {
        success: true,
        data: {
          url: finalUrl.toString(),
          host: finalUrl.hostname,
          title: page.title,
          siteName: page.siteName,
          publishedAt: page.publishedAt,
          fetchedAt: new Date().toISOString(),
          text: page.text,
          chars: page.text.length,
          truncated: page.text.length >= MAX_CHARS,
        },
      },
      { headers: corsHeaders },
    );
  } catch (e) {
    if (e instanceof WebError) return Response.json({ success: false, error: e.message }, { status: e.status, headers: corsHeaders });
    console.error("[fetch-web-source] error", (e as Error)?.name);
    return Response.json({ success: false, error: "처리 중 오류가 발생했습니다." }, { status: 500, headers: corsHeaders });
  }
});
