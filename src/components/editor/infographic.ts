/**
 * 인포그래픽 만들기에 쓰는 도구 모음
 * - 기사 글에서 숫자 뽑기 (서버 AI 실패 시 쓰는 간단한 자체 뽑기 포함)
 * - 뽑은 숫자로 16:9 그림(캔버스) 그리기
 */

export interface InfographicItem {
  label: string;
  value: number;
}

export interface InfographicData {
  title: string;
  unit: string; // 예: '%', '명', '억 원'
  items: InfographicItem[];
}

export type InfographicStyle = 'bar' | 'column' | 'donut' | 'cards';

export const INFOGRAPHIC_W = 1600;
export const INFOGRAPHIC_H = 900;

const UNITS = ['억 원', '조 원', '만 원', '만 명', '억 달러', '%', '퍼센트', '명', '건', '원', '개', '곳', '배', '위', '달러', '톤', '가구', '세', '회', '대'];

/** 서버 AI를 쓰지 못할 때를 위한 간단한 숫자 뽑기 (정확도는 AI보다 낮음) */
export function extractLocal(title: string, paragraphs: string[]): InfographicData {
  const found: { label: string; value: number; unit: string }[] = [];
  const unitPattern = UNITS.map(u => u.replace(/\s/g, '\\s?')).join('|');
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${unitPattern})`, 'g');

  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?。])\s+|\n/);
    for (const sent of sentences) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(sent)) !== null) {
        const value = parseFloat(m[1].replace(/,/g, ''));
        if (!isFinite(value)) continue;
        const unit = m[2] === '퍼센트' ? '%' : m[2].replace(/\s/g, ' ');
        // 숫자 앞의 말 중 가까운 몇 단어를 이름표로 사용
        const before = sent.slice(0, m.index).replace(/[“”"'‘’()\[\]]/g, ' ').trim();
        const words = before.split(/[\s,·]+/).filter(Boolean).slice(-3);
        const label = (words.join(' ') || '항목').slice(-14);
        found.push({ label, value, unit });
      }
    }
  }

  if (found.length === 0) return { title, unit: '', items: [] };

  // 가장 많이 나온 단위로 통일 (한 그림에는 같은 단위만 담기)
  const count = new Map<string, number>();
  found.forEach(f => count.set(f.unit, (count.get(f.unit) || 0) + 1));
  const unit = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const items = found.filter(f => f.unit === unit).slice(0, 6).map(({ label, value }) => ({ label, value }));
  return { title, unit, items };
}

/** 서버 AI가 돌려준 값을 안전하게 정리 */
export function normalizeData(raw: any, fallbackTitle: string): InfographicData {
  const items: InfographicItem[] = Array.isArray(raw?.items)
    ? raw.items
        .map((i: any) => ({ label: String(i?.label ?? '').slice(0, 20), value: Number(i?.value) }))
        .filter((i: InfographicItem) => i.label && isFinite(i.value))
        .slice(0, 8)
    : [];
  return {
    title: String(raw?.title || fallbackTitle || '').slice(0, 60),
    unit: String(raw?.unit ?? '').slice(0, 10),
    items,
  };
}

const FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#22c55e'];

export function formatValue(v: number, unit: string): string {
  const s = Number.isInteger(v) ? v.toLocaleString('ko-KR') : String(Math.round(v * 100) / 100);
  if (!unit) return s;
  return unit === '%' ? `${s}%` : `${s}${unit.length > 1 ? ' ' : ''}${unit}`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function drawInfographic(canvas: HTMLCanvasElement, data: InfographicData, style: InfographicStyle) {
  const W = INFOGRAPHIC_W;
  const H = INFOGRAPHIC_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, 14);

  // 제목
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText(fitText(ctx, data.title || '핵심 숫자', W - 160), 80, 120);
  ctx.fillStyle = '#64748b';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(data.unit ? `단위: ${data.unit}` : '', 80, 168);

  const items = data.items.filter(i => isFinite(i.value));
  const top = 210;
  const bottom = H - 90;
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);

  if (items.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 36px ${FONT}`;
    ctx.fillText('표시할 숫자가 없습니다', 80, 420);
  } else if (style === 'bar') {
    const rowH = Math.min(96, (bottom - top) / items.length);
    const labelW = 340;
    const barX = 80 + labelW;
    const barMaxW = W - barX - 280;
    items.forEach((it, i) => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      ctx.fillStyle = '#334155';
      ctx.font = `600 30px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, it.label, labelW - 20), barX - 20, cy + 11);
      const bw = Math.max(6, (Math.abs(it.value) / max) * barMaxW);
      ctx.fillStyle = COLORS[i % COLORS.length];
      const bh = Math.min(48, rowH * 0.62);
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(barX, cy - bh / 2, bw, bh, 8) : ctx.rect(barX, cy - bh / 2, bw, bh);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = `800 32px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(formatValue(it.value, data.unit), barX + bw + 16, cy + 11);
    });
  } else if (style === 'column') {
    const n = items.length;
    const areaW = W - 160;
    const slot = areaW / n;
    const bw = Math.min(150, slot * 0.6);
    const baseY = bottom - 70;
    const chartH = baseY - top - 50;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, baseY);
    ctx.lineTo(W - 80, baseY);
    ctx.stroke();
    items.forEach((it, i) => {
      const cx = 80 + slot * i + slot / 2;
      const h = Math.max(6, (Math.abs(it.value) / max) * chartH);
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(cx - bw / 2, baseY - h, bw, h, [10, 10, 0, 0]) : ctx.rect(cx - bw / 2, baseY - h, bw, h);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.font = `800 30px ${FONT}`;
      ctx.fillText(formatValue(it.value, data.unit), cx, baseY - h - 14);
      ctx.fillStyle = '#334155';
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(fitText(ctx, it.label, slot - 16), cx, baseY + 42);
    });
    ctx.textAlign = 'left';
  } else if (style === 'donut') {
    // 원형(도넛) 그래프: 왼쪽에 원, 오른쪽에 항목·값·비율
    const shown = items.filter(i => Math.abs(i.value) > 0);
    const total = shown.reduce((a, i) => a + Math.abs(i.value), 0) || 1;
    const cx = 80 + 280;
    const cy = (top + bottom) / 2 + 10;
    const R = Math.min(300, (bottom - top) / 2);
    const r = R * 0.58;
    let start = -Math.PI / 2;
    shown.forEach((it, i) => {
      const ang = (Math.abs(it.value) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, start, start + ang);
      ctx.arc(cx, cy, r, start + ang, start, true);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
      start += ang;
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText(formatValue(total, data.unit), cx, cy + 10);
    ctx.fillStyle = '#64748b';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText('합계', cx, cy + 46);
    const lx = cx + R + 120;
    const rowH = Math.min(84, (bottom - top) / Math.max(shown.length, 1));
    const ly = cy - (rowH * shown.length) / 2;
    ctx.textAlign = 'left';
    shown.forEach((it, i) => {
      const y = ly + i * rowH + rowH / 2;
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(lx, y - 14, 28, 28, 6) : ctx.rect(lx, y - 14, 28, 28);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.font = `600 30px ${FONT}`;
      ctx.fillText(fitText(ctx, it.label, 420), lx + 48, y + 11);
      const pct = Math.round((Math.abs(it.value) / total) * 1000) / 10;
      ctx.fillStyle = '#0f172a';
      ctx.font = `800 30px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${formatValue(it.value, data.unit)} (${pct}%)`, W - 80, y + 11);
      ctx.textAlign = 'left';
    });
  } else {
    // 큰 숫자 카드 (최대 4개)
    const shown = items.slice(0, 4);
    const gap = 36;
    const cw = (W - 160 - gap * (shown.length - 1)) / shown.length;
    const ch = bottom - top - 40;
    shown.forEach((it, i) => {
      const x = 80 + i * (cw + gap);
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(x, top + 20, cw, ch, 24) : ctx.rect(x, top + 20, cw, ch);
      ctx.fill();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(x + 36, top + 56, 64, 8);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0f172a';
      let size = 86;
      const text = formatValue(it.value, data.unit);
      ctx.font = `900 ${size}px ${FONT}`;
      while (ctx.measureText(text).width > cw - 72 && size > 28) {
        size -= 4;
        ctx.font = `900 ${size}px ${FONT}`;
      }
      ctx.fillText(text, x + 36, top + 20 + ch / 2 + 10);
      ctx.fillStyle = '#475569';
      ctx.font = `600 30px ${FONT}`;
      ctx.fillText(fitText(ctx, it.label, cw - 72), x + 36, top + 20 + ch - 50);
    });
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText('자료: 기사 본문', 80, H - 36);
}

export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (!b) return reject(new Error('이미지를 만들지 못했습니다.'));
      resolve(new File([b], name, { type: 'image/png' }));
    }, 'image/png');
  });
}
