import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS 헤더
import { loadLlmConfig, callLlm, llmErrorResponse, llmMissingResponse, type LlmConfig } from "../_shared/llm.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-ai-key, x-user-ai-provider, x-user-ai-model, x-user-ai-endpoint",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


interface FiveW1H {
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
}

interface QuoteItem {
  speaker: string;
  quote: string;
}

interface KeyFigureItem {
  label: string;
  value: string;
}

interface DraftState {
  topic: string;
  keywords: string[];
  five_w1h: FiveW1H;
  quotes: QuoteItem[];
  key_figures: KeyFigureItem[];
  open_gaps: string[];
  title_candidates: string[];
  lead_paragraph: string | null;
  body_blocks: string[];
}

interface ConversationItem {
  role: "ai" | "reporter";
  content: string;
  created_at: string;
}

interface RequestBody {
  action: "start" | "answer" | "regenerate_section" | "revise_draft" | "finalize";
  articleId: string;
  sessionId?: string;
  topic?: string;
  keywords?: string[];
  rawNotes?: string;
  answerText?: string;
  sectionType?: "lead" | "block";
  sectionIndex?: number;
  feedbackText?: string;
  instructionText?: string;
  tone?: "straight" | "explanatory" | "interview" | "feature" | string;
}

// 텍스트 자르기 헬퍼 (XSS 및 과도한 메모리 방어)
function safeSlice(str: unknown, maxLen = 1000): string {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, maxLen);
}

// 안전한 JSON 파싱 헬퍼
function safeJsonParse(rawText: string): any {
  try {
    return JSON.parse(rawText.trim());
  } catch {
    const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

Deno.serve(async (req) => {
  // CORS Preflight 처리
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return Response.json(
        { error: "POST 메서드만 지원합니다." },
        { status: 405, headers: corsHeaders }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json(
        { error: "인증 토큰이 필요합니다.", code: "UNAUTHORIZED" },
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. 사용자 JWT 인증 확인
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return Response.json(
        { error: "유효하지 않은 사용자 세션입니다.", code: "UNAUTHORIZED" },
        { status: 401, headers: corsHeaders }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. 프로필 및 권한 검증 (HR 계정 배제)
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("department, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "사용자 프로필을 조회할 수 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    if (profile.department === "인사부" || profile.role === "hr_admin") {
      return Response.json(
        { error: "인사부 계정은 뉴스룸 기사 작성 기능을 실행할 수 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    // 3. 요청 본문 파싱
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "잘못된 JSON 요청 본문입니다.", code: "INVALID_REQUEST" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { action, articleId } = body;
    if (!articleId || typeof articleId !== "string") {
      return Response.json(
        { error: "articleId는 필수 문자열입니다.", code: "INVALID_ARTICLE_ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!["start", "answer", "regenerate_section", "revise_draft", "finalize"].includes(action)) {
      return Response.json(
        { error: "유효하지 않은 action입니다.", code: "INVALID_ACTION" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. 기사 접근 권한 검증 (can_access_article RPC 재사용)
    const { data: hasAccess, error: accessError } = await adminClient
      .rpc("can_access_article", {
        p_article_id: articleId,
        p_uid: user.id,
      });

    if (accessError || !hasAccess) {
      return Response.json(
        { error: "해당 기사에 대한 접근 권한이 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    // 5-1. 개인 AI 키 확인
    // 개인 AI 설정: 계정에 암호화되어 저장된 공급자·키·모델을 읽는다
    let llmCfg: LlmConfig | null = null;
    try {
      llmCfg = await loadLlmConfig(adminClient, user.id);
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      throw e;
    }
    if (!llmCfg) {
      return llmMissingResponse(corsHeaders);
    }

    // 6. 기존 세션 로드 또는 초기화
    let currentSession: {
      id: string;
      draft_state: DraftState;
      conversation: ConversationItem[];
      status: string;
    } | null = null;

    if (body.sessionId) {
      const { data: sessData } = await adminClient
        .from("ai_draft_sessions")
        .select("id, draft_state, conversation, status")
        .eq("id", body.sessionId)
        .eq("article_id", articleId)
        .maybeSingle();

      if (sessData) {
        currentSession = sessData as any;
      }
    }

    // sessionId가 지정되지 않았더라도 해당 article의 최신 세션이 있는지 탐색
    if (!currentSession && action !== "start") {
      const { data: latestSess } = await adminClient
        .from("ai_draft_sessions")
        .select("id, draft_state, conversation, status")
        .eq("article_id", articleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestSess) {
        currentSession = latestSess as any;
      }
    }

    // 세션 기본값
    const emptyDraftState: DraftState = {
      topic: safeSlice(body.topic, 200),
      keywords: Array.isArray(body.keywords) ? body.keywords.map(k => safeSlice(k, 50)).slice(0, 10) : [],
      five_w1h: { who: null, what: null, when: null, where: null, why: null, how: null },
      quotes: [],
      key_figures: [],
      open_gaps: ["who", "what", "when", "where", "why", "how"],
      title_candidates: [],
      lead_paragraph: null,
      body_blocks: [],
    };

    let draftState: DraftState = currentSession?.draft_state || emptyDraftState;
    let conversation: ConversationItem[] = currentSession?.conversation || [];

    // 7. 시스템 프롬프트 및 액션별 사용자 프롬프트 구성
    const tone = safeSlice(body.tone, 50) || "straight";
    const toneInstructions: Record<string, string> = {
      straight: "스트레이트 톤: 두괄식 역피라미드 구조, 간결·명확한 단문 위주, 감정이나 수식어 배제, 사실관계 중심의 신속한 보도 스타일.",
      explanatory: "해설·분석 톤: 사건의 배경과 원인 맥락, 파급 효과, 다각적 쟁점과 향후 전망을 깊이 있게 설명하는 분석적 스타일.",
      interview: "인터뷰 톤: 취재원과의 생생한 대화 및 문답 구조, 핵심 인용구(따옴표)와 발언자의 어조 및 맥락을 부각하는 스타일.",
      feature: "피처·르포 톤: 현장의 분위기와 시각적 스케치, 시간 순서에 따른 서사 전개와 구체적인 정황 묘사 스타일.",
    };
    const toneGuide = toneInstructions[tone] || toneInstructions.straight;

    const systemPrompt = `너는 기사를 대신 쓰는 기자가 아니라, 기자를 취재 현장에서 돕는 질문자(인터뷰어)이자 사실 기반 초안 조립자다.
[절대 준수 원칙]
1. 기자가 답변하지 않은 사실을 절대 상상하거나 지어내지 마라.
2. 모든 문장과 수치, 인용은 오직 기자의 입력/답변에서 직접 근거를 찾을 수 있어야 한다.
3. 근거가 없거나 기자가 아직 답하지 않은 필수 취재 요소는 문장으로 날조하지 말고 반드시 "[확인 필요: ○○]" 형태로 남겨라.
4. 한 번에 너무 많은 질문을 하지 마라. 기자가 답하기 쉽도록 가장 중요한 1~2개의 구체적인 질문만 간결하게 제시하라. 이미 기자가 답변하여 채워진 항목은 다시 묻지 마라.
5. 어조는 전문적이고 예의 바른 언론사 데스크/취재 파트너 톤(하십시오체/해요체 조화)을 사용하라.
[지정된 기사 톤 및 스타일]
- ${toneGuide}

출력은 반드시 JSON 스키마를 엄격히 준수해야 한다.`;

    let userPrompt = "";

    if (action === "start") {
      const topicText = safeSlice(body.topic, 300) || "미정";
      const keywordsText = (body.keywords || []).map(k => safeSlice(k, 50)).join(", ") || "없음";
      const notesText = safeSlice(body.rawNotes, 6000) || "없음";

      userPrompt = `[기자의 최초 취재 메모 입력]
- 주제: ${topicText}
- 핵심 키워드: ${keywordsText}
- 취재 원자료/메모: ${notesText}

[지시사항]
1. 기자가 제공한 메모에서 이미 확인 가능한 5W1H 요소(누가, 무엇을, 언제, 어디서, 왜, 어떻게), 인용구, 주요 수치를 추출하여 updated_draft_state에 반영하라.
2. 아직 확인되지 않은 요소들을 open_gaps 배열에 나열하라.
3. 기사 작성을 위해 가장 시급하게 확인해야 할 핵심 사실 1~2개를 정중하게 질문(questions)하라.
4. JSON 형식으로 응답하라.

JSON 스키마:
{
  "questions": ["질문 1", "질문 2(선택)"],
  "updated_draft_state": {
    "topic": "${topicText}",
    "keywords": [${(body.keywords || []).map(k => `"${safeSlice(k, 50)}"`).join(",")}],
    "five_w1h": { "who": "...", "what": "...", "when": "...", "where": "...", "why": "...", "how": "..." },
    "quotes": [{ "speaker": "발언자", "quote": "인용문" }],
    "key_figures": [{ "label": "수치 항목", "value": "값" }],
    "open_gaps": ["아직 비어있는 요소들"],
    "title_candidates": [],
    "lead_paragraph": null,
    "body_blocks": []
  },
  "ready_to_finalize": false
}`;
    } else if (action === "answer") {
      const answer = safeSlice(body.answerText, 2000);
      userPrompt = `[현재까지의 수집 상태 (draft_state)]
${JSON.stringify(draftState, null, 2)}

[최근 대화 내역]
${conversation.slice(-4).map(c => `${c.role === "ai" ? "AI 질문" : "기자 답변"}: ${c.content}`).join("\n")}

[기자의 새로운 답변]
"${answer}"

[지시사항]
1. 기자의 답변에서 새로운 사실, 인용구, 수치를 추출하여 updated_draft_state의 five_w1h, quotes, key_figures를 보완하라.
2. 새롭게 채워진 요소는 open_gaps에서 제거하라.
3. 아직 채워지지 않은 open_gaps 항목 중 다음으로 중요한 1~2개 질문(questions)을 생성하라.
4. 만약 5W1H 중 핵심 요소(who, what, when, where)가 충분히 채워졌다면 ready_to_finalize를 true로 설정하고, 기자가 언제든 초안을 조립할 수 있음을 안내하라.
5. JSON 형식으로 응답하라.

JSON 스키마:
{
  "questions": ["다음 질문 1", "다음 질문 2(선택)"],
  "updated_draft_state": { ... },
  "ready_to_finalize": boolean
}`;
    } else if (action === "regenerate_section") {
      const fb = safeSlice(body.feedbackText, 500);
      const sType = body.sectionType || "lead";
      const sIdx = typeof body.sectionIndex === "number" ? body.sectionIndex : 0;

      userPrompt = `[현재까지 수집된 사실관계 (draft_state)]
${JSON.stringify(draftState, null, 2)}

[재작성 대상 섹션]
- 섹션 유형: ${sType === "lead" ? "리드 문단(lead_paragraph)" : `본문 블록 ${sIdx}번째`}
- 현재 내용: ${sType === "lead" ? draftState.lead_paragraph : draftState.body_blocks[sIdx] || "없음"}
- 기자의 피드백/수정 요구: "${fb}"

[지시사항]
1. 기존에 수집된 draft_state 사실관계 범위 내에서만 해당 섹션을 다시 작성하라.
2. 기자가 요구한 피드백 방향("더 간결하게", "표현 변경" 등)을 반영하되, 새로운 사실을 임의로 추가하지 마라.
3. 사실이 부족하면 반드시 "[확인 필요: ○○]" 표시를 사용하라.
4. JSON 형식으로 응답하라.

JSON 스키마:
{
  "questions": [],
  "updated_draft_state": { ... },
  "rewritten_text": "새로 작성된 섹션 텍스트",
  "ready_to_finalize": true
}`;
    } else if (action === "revise_draft") {
      const instruction = safeSlice(body.instructionText, 500);
      userPrompt = `[현재까지 수집된 사실관계와 초안 (draft_state)]
${JSON.stringify(draftState, null, 2)}

[기자의 전체 수정 지시]
"${instruction}"

[지시사항]
1. 기자의 지시("전체를 더 짧게", "제목을 덜 자극적으로", "해설 톤으로" 등)를 title_candidates, lead_paragraph, body_blocks 전체에 반영해 다시 작성하라.
2. draft_state에 이미 있는 사실관계(five_w1h, quotes, key_figures) 범위 안에서만 쓰고, 새로운 사실·수치·인용을 절대 추가하지 마라.
3. 사실이 부족한 곳은 기존처럼 "[확인 필요: ○○]" 표시를 그대로 유지하라.
4. 지시가 사실을 새로 만들어 달라는 요구(예: "수치를 더 넣어줘")라면 지어내지 말고 해당 위치에 "[확인 필요: ○○]"로 남겨라.
5. JSON 형식으로 응답하라.

JSON 스키마:
{
  "questions": [],
  "updated_draft_state": {
    "topic": "...",
    "keywords": [...],
    "five_w1h": { ... },
    "quotes": [...],
    "key_figures": [...],
    "open_gaps": [...],
    "title_candidates": ["제목 후보 1", "제목 후보 2"],
    "lead_paragraph": "수정된 리드",
    "body_blocks": ["수정된 본문 1", "수정된 본문 2"]
  },
  "ready_to_finalize": true
}`;
    } else if (action === "finalize") {
      userPrompt = `[현재까지 수집된 취재 사실관계 (draft_state)]
${JSON.stringify(draftState, null, 2)}

[지시사항]
현재까지 기자가 답변한 사실관계만을 100% 근거로 하여 완전한 기사 초안을 조립하라.
1. 제목 후보(title_candidates): 2~3개 (스트레이트형, 해설형 등)
2. 리드 문단(lead_paragraph): 가장 핵심적인 사실(1문단, 2~3문장)
3. 본문 블록(body_blocks): 2~4개 문단. 각 문단은 배경, 세부 경과, 관계자 발언(인용), 수치 분석 등을 다룬다.
4. 중요: 기자가 답변하지 않아 확인되지 않은 open_gaps 항목은 기사 본문에 "[확인 필요: ○○]" 형태로 정확하게 남기고 절대 거짓으로 채우지 마라.
5. JSON 형식으로 응답하라.

JSON 스키마:
{
  "questions": [],
  "updated_draft_state": {
    "topic": "...",
    "keywords": [...],
    "five_w1h": { ... },
    "quotes": [...],
    "key_figures": [...],
    "open_gaps": [...],
    "title_candidates": ["제목 후보 1", "제목 후보 2", "제목 후보 3"],
    "lead_paragraph": "리드 문단 텍스트...",
    "body_blocks": ["본문 1문단...", "본문 2문단...", "본문 3문단..."]
  },
  "ready_to_finalize": true
}`;
    }

    // 8. AI 호출 (사용자가 고른 공급자·모델, 일시 오류면 1회 자동 재시도)
    let rawContent = "";
    let callError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        rawContent = await callLlm(llmCfg, {
          log: { admin: adminClient, userId: user.id, fn: "ai-interview-draft" },
          system: systemPrompt,
          user: userPrompt,
          maxTokens: 8192,
          temperature: 0.1,
        });
        callError = null;
        break;
      } catch (e) {
        callError = e;
        const known = llmErrorResponse(e, corsHeaders);
        if (known) return known; // 키·한도·설정 문제는 재시도해도 같으므로 바로 안내
        console.warn(`[ai-interview-draft] Attempt ${attempt} failed:`, (e as Error)?.message);
      }
    }

    if (callError || !rawContent) {
      console.error("[ai-interview-draft] All attempts failed");
      return Response.json(
        { error: "AI 인터뷰 서비스 호출에 일시적으로 실패했습니다. 잠시 후 다시 시도해주세요.", code: "AI_CALL_FAILED" },
        { status: 502, headers: corsHeaders }
      );
    }

    // 9. Runtime Schema Validation
    let parsed: any;
    try {
      parsed = safeJsonParse(rawContent);
    } catch {
      console.error("[ai-interview-draft] JSON Parse Error. Raw:", rawContent);
      return Response.json(
        { error: "AI 응답을 해석하지 못했습니다. 다시 시도해주세요.", code: "PARSE_ERROR" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 결과 정규화
    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const sanitizedQuestions = rawQuestions.map((q: any) => safeSlice(q, 300)).filter(Boolean).slice(0, 2);

    const newState: DraftState = {
      topic: safeSlice(parsed.updated_draft_state?.topic || draftState.topic, 200),
      keywords: Array.isArray(parsed.updated_draft_state?.keywords)
        ? parsed.updated_draft_state.keywords.map((k: any) => safeSlice(k, 50)).slice(0, 10)
        : draftState.keywords,
      five_w1h: {
        who: parsed.updated_draft_state?.five_w1h?.who ? safeSlice(parsed.updated_draft_state.five_w1h.who, 200) : draftState.five_w1h.who,
        what: parsed.updated_draft_state?.five_w1h?.what ? safeSlice(parsed.updated_draft_state.five_w1h.what, 300) : draftState.five_w1h.what,
        when: parsed.updated_draft_state?.five_w1h?.when ? safeSlice(parsed.updated_draft_state.five_w1h.when, 200) : draftState.five_w1h.when,
        where: parsed.updated_draft_state?.five_w1h?.where ? safeSlice(parsed.updated_draft_state.five_w1h.where, 200) : draftState.five_w1h.where,
        why: parsed.updated_draft_state?.five_w1h?.why ? safeSlice(parsed.updated_draft_state.five_w1h.why, 400) : draftState.five_w1h.why,
        how: parsed.updated_draft_state?.five_w1h?.how ? safeSlice(parsed.updated_draft_state.five_w1h.how, 400) : draftState.five_w1h.how,
      },
      quotes: Array.isArray(parsed.updated_draft_state?.quotes)
        ? parsed.updated_draft_state.quotes.map((item: any) => ({
            speaker: safeSlice(item?.speaker, 100),
            quote: safeSlice(item?.quote, 500),
          })).slice(0, 10)
        : draftState.quotes,
      key_figures: Array.isArray(parsed.updated_draft_state?.key_figures)
        ? parsed.updated_draft_state.key_figures.map((item: any) => ({
            label: safeSlice(item?.label, 100),
            value: safeSlice(item?.value, 100),
          })).slice(0, 10)
        : draftState.key_figures,
      open_gaps: Array.isArray(parsed.updated_draft_state?.open_gaps)
        ? parsed.updated_draft_state.open_gaps.map((g: any) => safeSlice(g, 100)).slice(0, 10)
        : draftState.open_gaps,
      title_candidates: Array.isArray(parsed.updated_draft_state?.title_candidates)
        ? parsed.updated_draft_state.title_candidates.map((t: any) => safeSlice(t, 200)).slice(0, 5)
        : draftState.title_candidates,
      lead_paragraph: parsed.updated_draft_state?.lead_paragraph
        ? safeSlice(parsed.updated_draft_state.lead_paragraph, 2000)
        : draftState.lead_paragraph,
      body_blocks: Array.isArray(parsed.updated_draft_state?.body_blocks)
        ? parsed.updated_draft_state.body_blocks.map((b: any) => safeSlice(b, 3000)).slice(0, 10)
        : draftState.body_blocks,
    };

    // 대화 내역 갱신
    const nowIso = new Date().toISOString();
    const newConversation = [...conversation];

    if (action === "start") {
      newConversation.push({
        role: "reporter",
        content: `주제: ${newState.topic || "미정"}${body.rawNotes ? `\n메모: ${safeSlice(body.rawNotes, 300)}` : ""}`,
        created_at: nowIso,
      });
      if (sanitizedQuestions.length > 0) {
        newConversation.push({
          role: "ai",
          content: sanitizedQuestions.join("\n\n"),
          created_at: nowIso,
        });
      }
    } else if (action === "answer" && body.answerText) {
      newConversation.push({
        role: "reporter",
        content: safeSlice(body.answerText, 1000),
        created_at: nowIso,
      });
      if (sanitizedQuestions.length > 0) {
        newConversation.push({
          role: "ai",
          content: sanitizedQuestions.join("\n\n"),
          created_at: nowIso,
        });
      }
    } else if (action === "regenerate_section" && body.feedbackText) {
      newConversation.push({
        role: "reporter",
        content: `[수정 요청]: ${safeSlice(body.feedbackText, 500)}`,
        created_at: nowIso,
      });
      newConversation.push({
        role: "ai",
        content: `요청하신 피드백을 반영하여 해당 섹션을 재작성했습니다.`,
        created_at: nowIso,
      });
    } else if (action === "revise_draft" && body.instructionText) {
      newConversation.push({
        role: "reporter",
        content: `[전체 수정 지시]: ${safeSlice(body.instructionText, 500)}`,
        created_at: nowIso,
      });
      newConversation.push({
        role: "ai",
        content: `지시하신 내용을 반영해 제목과 본문 초안을 다시 작성했습니다. 새로 추가한 사실은 없습니다.`,
        created_at: nowIso,
      });
    } else if (action === "finalize") {
      newConversation.push({
        role: "reporter",
        content: `기사 초안 정리 및 조립 요청`,
        created_at: nowIso,
      });
      newConversation.push({
        role: "ai",
        content: `지금까지 수집된 사실관계를 바탕으로 제목 후보와 본문 초안을 조립했습니다. 아직 확인되지 않은 항목은 [확인 필요]로 표시했습니다.`,
        created_at: nowIso,
      });
    }

    const sessionStatus = (action === "finalize" || action === "revise_draft") ? "finalized" : "collecting";

    // 10. DB ai_draft_sessions 세션 레코드 원자적 저장 (Upsert)
    let savedSessionId = currentSession?.id;

    if (currentSession?.id) {
      const { error: updateError } = await adminClient
        .from("ai_draft_sessions")
        .update({
          draft_state: newState,
          conversation: newConversation,
          status: sessionStatus,
          updated_at: nowIso,
        })
        .eq("id", currentSession.id);

      if (updateError) {
        console.error("[ai-interview-draft] Session update error:", updateError);
      }
    } else {
      const { data: newSess, error: insertError } = await adminClient
        .from("ai_draft_sessions")
        .insert({
          article_id: articleId,
          author_id: user.id,
          status: sessionStatus,
          draft_state: newState,
          conversation: newConversation,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("[ai-interview-draft] Session insert error:", insertError);
      } else {
        savedSessionId = newSess.id;
      }
    }

    return Response.json(
      {
        success: true,
        sessionId: savedSessionId,
        questions: sanitizedQuestions,
        draftState: newState,
        conversation: newConversation,
        readyToFinalize: Boolean(parsed.ready_to_finalize || action === "finalize" || action === "revise_draft"),
        rewrittenText: parsed.rewritten_text,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[ai-interview-draft] Unexpected error:", err);
    return Response.json(
      { error: "AI 인터뷰 처리 중 예기치 않은 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", code: "INTERNAL_ERROR" },
      { status: 500, headers: corsHeaders }
    );
  }
});
