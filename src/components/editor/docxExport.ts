/**
 * 기사 → 워드(.docx) 파일 만들기. 별도 프로그램 설치 없이 직접 .docx(압축 묶음)를 조립한다.
 * 사진은 파일 안에 함께 담기므로 인터넷 연결이 없어도 보인다.
 */

import type { CropFocus } from '../common/mediaCrop';

export interface DocxBlock {
  id: string;
  type: 'paragraph' | 'image' | 'video' | 'quote';
  text?: string;
  caption?: string;
  credit?: string;
  imageUrl?: string;
  /** 편집기에서 정한 자르기·확대 값 (없으면 원본 전체) */
  crop?: CropFocus | null;
}

export interface DocxArticle {
  title: string;
  subtitle?: string;
  byline: string;
  blocks: DocxBlock[];
}

export interface LoadedImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export type ImageLoader = (url: string, crop?: CropFocus | null) => Promise<LoadedImage | null>;

const enc = new TextEncoder();

const xmlEsc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML에서 허용되지 않는 제어 문자 제거
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ---------- ZIP (압축 없이 담기) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = cat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name, f.data
    );
    chunks.push(local);
    central.push(cat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name
    ));
    offset += local.length;
  }
  const centralAll = cat(...central);
  const end = cat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralAll.length), u32(offset), u16(0)
  );
  return cat(...chunks, centralAll, end);
}

// ---------- 워드 문서 내용(XML) ----------
const FONT = '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>';

function run(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): string {
  const rpr =
    FONT +
    (opts.bold ? '<w:b/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    (opts.color ? `<w:color w:val="${opts.color}"/>` : '') +
    (opts.size ? `<w:sz w:val="${opts.size * 2}"/><w:szCs w:val="${opts.size * 2}"/>` : '');
  // 줄바꿈은 워드의 줄 바꿈으로
  const parts = String(text ?? '').split('\n');
  const inner = parts
    .map((p, i) => (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xmlEsc(p)}</w:t>`)
    .join('');
  return `<w:r><w:rPr>${rpr}</w:rPr>${inner}</w:r>`;
}

function para(runs: string, opts: { align?: 'center' | 'left'; after?: number; before?: number; indentLeft?: number; line?: number; borderLeft?: boolean; borderBottom?: boolean } = {}): string {
  const ppr =
    (opts.borderLeft || opts.borderBottom
      ? `<w:pBdr>${opts.borderLeft ? '<w:left w:val="single" w:sz="18" w:space="8" w:color="2563EB"/>' : ''}${opts.borderBottom ? '<w:bottom w:val="single" w:sz="6" w:space="6" w:color="CCCCCC"/>' : ''}</w:pBdr>`
      : '') +
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 160}" w:line="${opts.line ?? 360}" w:lineRule="auto"/>` +
    (opts.indentLeft ? `<w:ind w:left="${opts.indentLeft}"/>` : '') +
    (opts.align ? `<w:jc w:val="${opts.align}"/>` : '');
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

function imageParagraph(rid: string, id: number, cx: number, cy: number): string {
  return `<w:p><w:pPr><w:spacing w:before="200" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="사진 ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'png', 'image/bmp': 'bmp',
};

export async function buildDocx(article: DocxArticle, loadImage: ImageLoader): Promise<Uint8Array> {
  const media: Array<{ name: string; data: Uint8Array }> = [];
  const rels: string[] = [];
  const body: string[] = [];

  body.push(para(run(article.title, { bold: true, size: 20 }), { after: 120, line: 300 }));
  if (article.subtitle) body.push(para(run(article.subtitle, { size: 13, color: '555555' }), { after: 160, line: 300 }));
  body.push(para(run(article.byline, { size: 9, color: '777777' }), { after: 280, borderBottom: true, line: 300 }));

  let imgNo = 0;
  for (const b of article.blocks) {
    if (b.type === 'paragraph') {
      if (b.text) body.push(para(run(b.text, { size: 11 }), { after: 200 }));
    } else if (b.type === 'image') {
      let loaded: LoadedImage | null = null;
      if (b.imageUrl) {
        try { loaded = await loadImage(b.imageUrl, b.crop); } catch { loaded = null; }
      }
      if (loaded && loaded.width > 0 && loaded.height > 0) {
        imgNo++;
        const ext = EXT_BY_MIME[loaded.mime] || 'png';
        const fileName = `image${imgNo}.${ext}`;
        media.push({ name: `word/media/${fileName}`, data: loaded.bytes });
        const rid = `rIdImg${imgNo}`;
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`);
        // 본문 폭(약 15.5cm)에 맞추고, 너무 길면 높이를 제한
        const maxW = 5580000; // EMU
        const maxH = 6400000;
        let cx = maxW;
        let cy = Math.round((maxW * loaded.height) / loaded.width);
        if (cy > maxH) { cy = maxH; cx = Math.round((maxH * loaded.width) / loaded.height); }
        body.push(imageParagraph(rid, imgNo, cx, cy));
      } else {
        body.push(para(run('[사진을 불러오지 못했습니다]', { italic: true, size: 10, color: '999999' }), { align: 'center' }));
      }
      const cap = `▲ ${b.caption || '보도사진'}${b.credit ? ` (${b.credit})` : ''}`;
      body.push(para(run(cap, { size: 9, color: '666666' }), { align: 'center', after: 240, line: 280 }));
    } else if (b.type === 'video') {
      body.push(para(run(`[보도영상 클립] ${b.caption || ''}`, { bold: true, size: 10 }), { after: 40, line: 280 }));
      body.push(para(run(`출처: ${b.credit || '본사 DB'}`, { size: 9, color: '777777' }), { after: 200, line: 280 }));
    } else if (b.type === 'quote' && b.text) {
      body.push(para(run(`"${b.text}"`, { italic: true, size: 11, color: '333333' }), { indentLeft: 360, borderLeft: true, after: b.caption ? 40 : 200 }));
      if (b.caption) body.push(para(run(`— ${b.caption}`, { size: 9, color: '666666' }), { indentLeft: 360, after: 200, line: 280 }));
    }
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    ...media,
  ]);
}
