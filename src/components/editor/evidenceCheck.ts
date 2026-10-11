/**
 * AI 초안의 "근거 문장 표시" 도구
 * - 초안의 각 문장이 기자가 준 자료(답변·취재 메모·수집 팩트)에서 나왔는지 글자 비교로 확인합니다.
 * - AI에게 다시 묻지 않고 브라우저에서만 계산하므로 비용이 들지 않습니다.
 * - 판정은 참고용입니다. "근거 없음"이라고 해서 틀린 문장이라는 뜻은 아니며, 기자가 한 번 더 확인하라는 표시입니다.
 */

export interface EvidenceSource {
  label: string; // 예: "답변 2", "취재 메모", "수집 팩트"
  text: string;
}

export type EvidenceStatus = 'supported' | 'unsupported' | 'neutral';

export interface EvidenceSegment {
  text: string;
  status: EvidenceStatus;
  source?: string; // 가장 잘 맞는 자료 이름
  note?: string; // 사람이 읽는 설명
}

const normalize = (s: string) => s.replace(/[\s,'"“”‘’「」『』()\[\]·]/g, '').toLowerCase();

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?。\n]+[.!?。]?["”』」]?\s*|\n+/g);
  return (parts || [paragraph]).filter((p) => p.length > 0);
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function extractNumbers(s: string): string[] {
  return (s.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/g, '').replace(/,/g, '')).filter((n) => n.length > 0);
}

export function checkEvidence(paragraph: string, sources: EvidenceSource[]): EvidenceSegment[] {
  const prepared = sources.map((src) => {
    const norm = normalize(src.text);
    return { label: src.label, norm, grams: trigrams(norm), numbers: new Set(extractNumbers(src.text)) };
  });

  return splitSentences(paragraph).map((raw): EvidenceSegment => {
    const text = raw;
    const trimmed = raw.trim();
    if (!trimmed || /^\[확인 필요/.test(trimmed) || trimmed.length < 6) {
      return { text, status: 'neutral' };
    }
    const norm = normalize(trimmed);
    const grams = trigrams(norm);
    const nums = extractNumbers(trimmed);

    let best: { label: string; ratio: number } | null = null;
    for (const p of prepared) {
      if (grams.size === 0) break;
      let hit = 0;
      grams.forEach((g) => {
        if (p.grams.has(g)) hit++;
      });
      const ratio = hit / grams.size;
      if (!best || ratio > best.ratio) best = { label: p.label, ratio };
    }

    const missingNums = nums.filter((n) => !prepared.some((p) => p.numbers.has(n) || p.norm.includes(n)));
    if (missingNums.length > 0) {
      return {
        text,
        status: 'unsupported',
        source: best?.label,
        note: `자료에서 찾지 못한 숫자: ${missingNums.join(', ')}`,
      };
    }
    if (best && best.ratio >= 0.4) {
      return { text, status: 'supported', source: best.label, note: `근거: ${best.label}` };
    }
    return { text, status: 'unsupported', source: best?.label, note: '기자가 준 자료에서 같은 내용을 찾지 못했습니다' };
  });
}

export function summarizeEvidence(all: EvidenceSegment[][]): { supported: number; unsupported: number } {
  let supported = 0;
  let unsupported = 0;
  all.forEach((segs) =>
    segs.forEach((s) => {
      if (s.status === 'supported') supported++;
      else if (s.status === 'unsupported') unsupported++;
    })
  );
  return { supported, unsupported };
}
