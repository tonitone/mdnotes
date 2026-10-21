import { getLocale, isRtl, t } from '../i18n';
import { parseMarkdown, type Block, type Inline, type ListItem } from './parse';

/**
 * Markdown → Word document (Office Open XML), without dependencies.
 *
 * Returns the parts of the package; the caller zips them (main process,
 * src/main/zip.ts). The document uses Word's built-in style names
 * (heading 1–6, Quote, List Paragraph, Hyperlink), so headings show up in the
 * navigation pane and screen readers, and images carry their alt text.
 */

export interface DocxImage {
  data: Uint8Array;
  /** Formats Word reads everywhere. WebP and SVG are left out (alt text instead). */
  ext: 'png' | 'jpeg' | 'gif';
  width: number;
  height: number;
}

export interface DocxOptions {
  /** Returns the image for a `src` from the note, or null to show its alt text instead. */
  loadImage?: (src: string) => DocxImage | null;
  /** Creation time for the document properties. */
  now?: Date;
}

export interface DocxPart {
  path: string;
  data: Uint8Array;
}

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  officeRel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A4 with 2 cm margins, in twentieths of a point. */
const PAGE = { width: 11906, height: 16838, margin: 1134 };
const CONTENT_TWIPS = PAGE.width - 2 * PAGE.margin;
/** Pixels at 96 dpi to EMU; images are limited to the text width. */
const EMU_PER_PX = 9525;
const MAX_IMAGE_EMU = CONTENT_TWIPS * 635;

/** Escapes text for XML and drops characters XML 1.0 does not allow. */
export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

class DocxWriter {
  private readonly rels: string[] = [];
  private readonly media: DocxPart[] = [];
  private readonly nums: string[] = [];
  private nextRel = 3; // rId1 styles, rId2 numbering
  private nextNum = 1;
  private nextDrawing = 1;

  constructor(private readonly opts: DocxOptions) {}

  private addRel(type: string, target: string, external = false): string {
    const id = `rId${this.nextRel++}`;
    this.rels.push(
      `<Relationship Id="${id}" Type="${NS.officeRel}/${type}" Target="${xmlEscape(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    );
    return id;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  private text(value: string, fmt: RunFormat): string {
    const props = [
      fmt.code ? '<w:rStyle w:val="CodeChar"/>' : fmt.link ? '<w:rStyle w:val="Hyperlink"/>' : '',
      fmt.bold ? '<w:b/>' : '',
      fmt.italic ? '<w:i/>' : '',
      fmt.strike ? '<w:strike/>' : '',
    ].join('');
    const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
    const content = value
      .split('\t')
      .map((part) => (part ? `<w:t xml:space="preserve">${xmlEscape(part)}</w:t>` : ''))
      .join('<w:tab/>');
    return `<w:r>${rPr}${content}</w:r>`;
  }

  private image(src: string, alt: string, fmt: RunFormat): string {
    const img = this.opts.loadImage?.(src) ?? null;
    if (!img) return this.text(alt ? `[${t('image.label', { alt })}]` : `[${t('image.missing')}]`, { ...fmt, italic: true });
    const n = this.nextDrawing++;
    const name = `image${n}.${img.ext}`;
    this.media.push({ path: `word/media/${name}`, data: img.data });
    const rel = this.addRel('image', `media/${name}`);
    let cx = img.width * EMU_PER_PX;
    let cy = img.height * EMU_PER_PX;
    if (cx > MAX_IMAGE_EMU) {
      cy = Math.round((cy * MAX_IMAGE_EMU) / cx);
      cx = MAX_IMAGE_EMU;
    }
    const descr = xmlEscape(alt);
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="${name}" descr="${descr}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${NS.pic}"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${n}" name="${name}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    );
  }

  runs(nodes: Inline[], fmt: RunFormat = {}): string {
    return nodes
      .map((n) => {
        switch (n.type) {
          case 'text':
            return this.text(n.value, fmt);
          case 'break':
            return '<w:r><w:br/></w:r>';
          case 'code':
            return this.text(n.value, { ...fmt, code: true });
          case 'strong':
            return this.runs(n.children, { ...fmt, bold: true });
          case 'em':
            return this.runs(n.children, { ...fmt, italic: true });
          case 'strike':
            return this.runs(n.children, { ...fmt, strike: true });
          case 'image':
            return this.image(n.src, n.alt, fmt);
          case 'link': {
            if (!isExternalLink(n.href)) return this.runs(n.children, fmt);
            const rel = this.addRel('hyperlink', n.href.trim(), true);
            return `<w:hyperlink r:id="${rel}" w:history="1">${this.runs(n.children, { ...fmt, link: true })}</w:hyperlink>`;
          }
        }
      })
      .join('');
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  private paragraph(content: string, style?: string, extra = ''): string {
    const pStyle = style ? `<w:pStyle w:val="${style}"/>` : '';
    const pPr = pStyle || extra ? `<w:pPr>${pStyle}${extra}</w:pPr>` : '';
    return `<w:p>${pPr}${content}</w:p>`;
  }

  /** A new list instance, so numbering starts again at 1. */
  private newNum(kind: 'bullet' | 'ordered', level: number): number {
    const id = this.nextNum++;
    const restart = kind === 'ordered' ? `<w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="1"/></w:lvlOverride>` : '';
    this.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${kind === 'bullet' ? 0 : 1}"/>${restart}</w:num>`);
    return id;
  }

  private list(items: ListItem[]): string {
    // Current list instance per level; a shallower item ends the deeper ones.
    const levels: Array<{ kind: 'bullet' | 'ordered'; id: number }> = [];
    return items
      .map((item) => {
        const level = Math.min(item.path.length - 1, 8);
        const kind = item.path[item.path.length - 1];
        levels.length = Math.min(levels.length, level + 1);
        if (item.checked !== null) {
          // Task items: a checkbox character instead of a bullet.
          const box = this.text(item.checked ? '☑ ' : '☐ ', {});
          return this.paragraph(box + this.runs(item.content), 'ListParagraph', `<w:ind w:left="${360 * (level + 1)}"/>`);
        }
        if (levels[level]?.kind !== kind) levels[level] = { kind, id: this.newNum(kind, level) };
        const numPr = `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${levels[level].id}"/></w:numPr>`;
        return this.paragraph(this.runs(item.content), 'ListParagraph', numPr);
      })
      .join('');
  }

  private table(block: Extract<Block, { type: 'table' }>): string {
    const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 1);
    const width = Math.floor(CONTENT_TWIPS / cols);
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A9B4BE"/>`;
    const jc = (i: number) => (block.align[i] ? `<w:jc w:val="${block.align[i]}"/>` : '');
    const row = (cells: Inline[][], header: boolean) => {
      const tcs = Array.from({ length: cols }, (_, i) => {
        const content = this.runs(cells[i] ?? [], header ? { bold: true } : {});
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${this.paragraph(content, undefined, jc(i))}</w:tc>`;
      }).join('');
      // A header row repeats on every page and tells screen readers what the columns are.
      return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs}</w:tr>`;
    };
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
      `<w:tblLook w:val="0420" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>` +
      `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>` +
      row(block.header, true) +
      block.rows.map((r) => row(r, false)).join('') +
      `</w:tbl>`
    );
  }

  blocks(blocks: Block[], quote = false): string {
    return blocks
      .map((block) => {
        switch (block.type) {
          case 'heading':
            return this.paragraph(this.runs(block.content), quote ? 'Quote' : `Heading${Math.min(block.level, 6)}`);
          case 'paragraph':
            return this.paragraph(block.lines.map((line) => this.runs(line)).join('<w:r><w:br/></w:r>'), quote ? 'Quote' : undefined);
          case 'code': {
            const lines = block.text.split('\n');
            // Space after the last line separates the block from what follows.
            return lines
              .map((line, i) => this.paragraph(line ? this.text(line, {}) : '', 'CodeBlock', i === lines.length - 1 ? '<w:spacing w:after="160"/>' : ''))
              .join('');
          }
          case 'quote':
            return this.blocks(block.children, true);
          case 'list':
            return this.list(block.items);
          case 'table':
            // Word needs a paragraph between a table and what follows.
            return this.table(block) + this.paragraph('');
          case 'hr':
            return this.paragraph('', undefined, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A9B4BE"/></w:pBdr>');
        }
      })
      .join('');
  }

  // -------------------------------------------------------------------------
  // Package
  // -------------------------------------------------------------------------

  document(body: string): string {
    return (
      XML_HEAD +
      `<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"><w:body>` +
      body +
      `<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
      `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="709" w:footer="709" w:gutter="0"/>` +
      `</w:sectPr></w:body></w:document>`
    );
  }

  documentRels(): string {
    return (
      XML_HEAD +
      `<Relationships xmlns="${NS.rel}">` +
      `<Relationship Id="rId1" Type="${NS.officeRel}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="${NS.officeRel}/numbering" Target="numbering.xml"/>` +
      this.rels.join('') +
      `</Relationships>`
    );
  }

  numbering(): string {
    const bullets = ['•', '◦', '▪'];
    const level = (kind: 'bullet' | 'ordered', l: number) =>
      `<w:lvl w:ilvl="${l}"><w:start w:val="1"/>` +
      (kind === 'bullet'
        ? `<w:numFmt w:val="bullet"/><w:lvlText w:val="${bullets[l % 3]}"/>`
        : `<w:numFmt w:val="decimal"/><w:lvlText w:val="%${l + 1}."/>`) +
      `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    const abstract = (id: number, kind: 'bullet' | 'ordered') =>
      `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      Array.from({ length: 9 }, (_, l) => level(kind, l)).join('') +
      `</w:abstractNum>`;
    return XML_HEAD + `<w:numbering xmlns:w="${NS.w}">${abstract(0, 'bullet')}${abstract(1, 'ordered')}${this.nums.join('')}</w:numbering>`;
  }

  get mediaParts(): DocxPart[] {
    return this.media;
  }
}

function styles(lang: string, rtl: boolean): string {
  const heading = (level: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    `<w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${level <= 2 ? 360 : 240}" w:after="120"/>` +
    `<w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="1D2D3E"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return (
    XML_HEAD +
    `<w:styles xmlns:w="${NS.w}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>` +
    `<w:color w:val="1D2D3E"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang}" w:bidi="${lang}"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr>${rtl ? '<w:bidi/>' : ''}<w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>` +
    heading(1, 40) + heading(2, 32) + heading(3, 28) + heading(4, 24) + heading(5, 22) + heading(6, 22) +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>` +
    `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="A9B4BE"/></w:pBdr><w:ind w:left="284"/></w:pPr><w:rPr><w:color w:val="475E75"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>` +
    `<w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F6F7"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="170" w:right="170"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:noProof/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:customStyle="1" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:basedOn w:val="DefaultParagraphFont"/>` +
    `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="EFF1F2"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>` +
    `<w:rPr><w:color w:val="0064D9"/><w:u w:val="single"/></w:rPr></w:style>` +
    `</w:styles>`
  );
}

function contentTypes(): string {
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return (
    XML_HEAD +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="gif" ContentType="image/gif"/>` +
    `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="${main}.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`
  );
}

function packageRels(): string {
  return (
    XML_HEAD +
    `<Relationships xmlns="${NS.rel}">` +
    `<Relationship Id="rId1" Type="${NS.officeRel}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${NS.officeRel}/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`
  );
}

function coreProps(title: string, lang: string, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    XML_HEAD +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlEscape(title)}</dc:title><dc:language>${lang}</dc:language>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

function appProps(): string {
  return XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>mdnotes</Application></Properties>`;
}

const LANG_TAGS: Record<string, string> = { de: 'de-DE', en: 'en-US' };

export function markdownToDocx(markdown: string, title: string, opts: DocxOptions = {}): DocxPart[] {
  const locale = getLocale();
  const lang = LANG_TAGS[locale] ?? locale;
  const writer = new DocxWriter(opts);
  const body = writer.blocks(parseMarkdown(markdown));
  const encode = (text: string) => new TextEncoder().encode(text);
  return [
    { path: '[Content_Types].xml', data: encode(contentTypes()) },
    { path: '_rels/.rels', data: encode(packageRels()) },
    { path: 'docProps/core.xml', data: encode(coreProps(title, lang, opts.now ?? new Date())) },
    { path: 'docProps/app.xml', data: encode(appProps()) },
    { path: 'word/document.xml', data: encode(writer.document(body)) },
    { path: 'word/styles.xml', data: encode(styles(lang, isRtl(locale))) },
    { path: 'word/numbering.xml', data: encode(writer.numbering()) },
    { path: 'word/_rels/document.xml.rels', data: encode(writer.documentRels()) },
    ...writer.mediaParts,
  ];
}
