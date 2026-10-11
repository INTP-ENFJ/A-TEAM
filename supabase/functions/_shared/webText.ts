/**
 * 웹 페이지 글자 뽑기 · 주소 안전 검사 · robots.txt 확인 (서버·테스트 공용 순수 함수)
 */

/** 사설망·내부 주소로 가는 숫자 주소인지 */
export function isPrivateIp(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const low = ip.toLowerCase();
  if (low.includes(":")) {
    if (low === "::1" || low === "::" || low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
    if (mapped) return isPrivateIp(mapped[1]);
  }
  return false;
}

/** 직접 입력한 주소가 외부 공개 웹 주소 형태인지 (문자열 검사만. 이름 풀이는 서버에서 따로) */
export function parsePublicWebUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") && !h.includes(":")) return null;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return null;
  if (isPrivateIp(h.replace(/^\[|\]$/g, ""))) return null;
  return u;
}

/** robots.txt에서 우리 수집기에 해당하는 규칙으로 이 경로가 막혀 있는지 */
export function isBlockedByRobots(robotsTxt: string, path: string, agent: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      cur.rules.push({ allow: key === "allow", path: val });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const me = agent.toLowerCase();
  let chosen = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  if (chosen.length === 0) chosen = groups.filter((g) => g.agents.includes("*"));
  let bestLen = -1;
  let blocked = false;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.path === "") continue; // 빈 Disallow = 모두 허용
      const pattern = r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
      if (new RegExp("^" + pattern).test(path) && r.path.length > bestLen) {
        bestLen = r.path.length;
        blocked = !r.allow;
      }
    }
  }
  return blocked;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const c = parseInt(n, 16);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : "";
    })
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function metaContent(html: string, key: string): string {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i");
  const m = re1.exec(html) || re2.exec(html);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

export interface ExtractedPage {
  title: string;
  siteName: string;
  publishedAt: string;
  text: string;
}

/** HTML에서 제목·출처 사이트·날짜·본문 글자를 뽑는다 (메뉴·광고·스크립트 제외) */
export function extractPage(html: string, maxChars: number): ExtractedPage {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = (metaContent(html, "og:title") || (titleTag ? decodeEntities(titleTag[1]) : "")).replace(/\s+/g, " ").trim().slice(0, 200);
  const siteName = metaContent(html, "og:site_name").slice(0, 80);
  const publishedAt = (metaContent(html, "article:published_time") || metaContent(html, "date") || metaContent(html, "pubdate")).slice(0, 40);

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|template|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");

  const article = /<article\b[\s\S]*?<\/article>/i.exec(body);
  const main = /<main\b[\s\S]*?<\/main>/i.exec(body);
  const picked = article && article[0].length > 400 ? article[0] : main && main[0].length > 400 ? main[0] : body;

  const text = decodeEntities(
    picked
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote|\/section)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => l.length >= 20)
    .join("\n")
    .slice(0, maxChars);

  return { title, siteName, publishedAt, text };
}

/** 응답 머리글·HTML 안내에서 글자 인코딩 이름을 찾는다 */
export function detectCharset(contentType: string, headBytes: Uint8Array): string {
  const h = /charset=["']?([\w-]+)/i.exec(contentType);
  if (h) return h[1].toLowerCase();
  const head = new TextDecoder("latin1").decode(headBytes.slice(0, 4096));
  const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : "utf-8";
}
