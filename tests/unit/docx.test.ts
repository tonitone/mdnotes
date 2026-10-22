import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setLocale } from '../../src/shared/i18n';
import { imageSize } from '../../src/shared/image-size';
import { markdownToDocx, xmlEscape } from '../../src/shared/markdown/docx';
import { markdownToHtmlDocument } from '../../src/shared/markdown/html';
import { createZip, readZip } from '../../src/main/zip';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Checks that every opened tag is closed in order (enough to catch broken XML from string building). */
function assertWellFormed(xml: string, name: string): void {
  const stack: string[] = [];
  for (const m of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)(?:\s[^>]*?)?(\/?)>/g)) {
    const [, closing, tag, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), tag, `${name}: unexpected </${tag}>`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), `${name}: unescaped &`);
}

function build(markdown: string, title = 'Titel', withImages = false) {
  const parts = markdownToDocx(markdown, title, {
    now: new Date('2026-10-21T10:00:00Z'),
    loadImage: withImages ? (src) => (src === 'assets/pixel.png' ? { data: PIXEL_PNG, ext: 'png', width: 1, height: 1 } : null) : undefined,
  });
  const files = new Map(parts.map((p) => [p.path, p.data]));
  const text = (path: string) => new TextDecoder().decode(files.get(path));
  return { parts, files, text };
}

const SAMPLE = `# Überschrift

Text mit **fett**, *kursiv*, ~~weg~~, \`code\` und [Link](https://example.com/?a=1&b=2).

## Liste

- eins
  1. unter eins
  2. unter zwei
- zwei
  1. wieder eins

1. erstens
2. zweitens

- [ ] offen
- [x] erledigt

> Zitat <mit> Zeichen

\`\`\`ts
const a = 1;
	tab
\`\`\`

| Name | Wert |
| :--- | ---: |
| a | 1 |

---

![Ein Pixel](assets/pixel.png) ![Fehlt](assets/missing.png)
`;

describe('markdownToDocx', () => {
  afterEach(() => setLocale('de'));

  it('produces all package parts, well-formed', () => {
    const { files, text } = build(SAMPLE, 'Titel & Co', true);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/_rels/document.xml.rels',
      'word/media/image1.png',
    ]) {
      assert.ok(files.has(part), part);
      if (part.endsWith('.xml') || part.endsWith('.rels')) assertWellFormed(text(part), part);
    }
  });

  it('uses heading styles and keeps inline formatting', () => {
    const doc = build(SAMPLE).text('word/document.xml');
    assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Überschrift<\/w:t>/);
    assert.match(doc, /<w:pStyle w:val="Heading2"\/>/);
    assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">fett/);
    assert.match(doc, /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">kursiv/);
    assert.match(doc, /<w:rPr><w:strike\/><\/w:rPr><w:t xml:space="preserve">weg/);
    assert.match(doc, /<w:rStyle w:val="CodeChar"\/><\/w:rPr><w:t xml:space="preserve">code/);
  });

  it('links external URLs through a relationship', () => {
    const { text } = build(SAMPLE);
    assert.match(text('word/document.xml'), /<w:hyperlink r:id="rId3" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/>/);
    assert.match(text('word/_rels/document.xml.rels'), /Id="rId3"[^>]*Target="https:\/\/example.com\/\?a=1&amp;b=2" TargetMode="External"/);
  });

  it('does not link unsafe or relative targets', () => {
    const { text } = build('[x](javascript:alert(1)) [y](notes/other.md)');
    assert.doesNotMatch(text('word/document.xml'), /w:hyperlink/);
    assert.doesNotMatch(text('word/_rels/document.xml.rels'), /javascript/);
  });

  it('numbers lists and restarts ordered lists', () => {
    const { text } = build(SAMPLE);
    const doc = text('word/document.xml');
    const numbering = text('word/numbering.xml');
    // Outer bullets share one list; each ordered sublist starts again.
    const ids = [...doc.matchAll(/<w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/>/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(ids, ['0:1', '1:2', '1:2', '0:1', '1:3', '0:4', '0:4']);
    assert.match(numbering, /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"\/>/);
    assert.match(numbering, /<w:num w:numId="1"><w:abstractNumId w:val="0"\/><\/w:num>/);
  });

  it('shows tasks as checkbox characters', () => {
    const doc = build(SAMPLE).text('word/document.xml');
    assert.match(doc, /☐ <\/w:t><\/w:r><w:r><w:t xml:space="preserve">offen/);
    assert.match(doc, /☑ <\/w:t><\/w:r><w:r><w:t xml:space="preserve">erledigt/);
  });

  it('escapes text and keeps code whitespace', () => {
    const doc = build(SAMPLE).text('word/document.xml');
    assert.match(doc, /Zitat &lt;mit&gt; Zeichen/);
    assert.match(doc, /<w:pStyle w:val="Quote"\/>/);
    assert.match(doc, /<w:pStyle w:val="CodeBlock"\/><\/w:pPr><w:r><w:t xml:space="preserve">const a = 1;/);
    assert.match(doc, /<w:r><w:tab\/><w:t xml:space="preserve">tab<\/w:t><\/w:r>/);
  });

  it('builds tables with a repeating, bold header row and alignment', () => {
    const doc = build(SAMPLE).text('word/document.xml');
    assert.match(doc, /<w:tr><w:trPr><w:tblHeader\/><\/w:trPr>/);
    assert.match(doc, /<w:jc w:val="left"\/><\/w:pPr><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Name/);
    assert.match(doc, /<w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">1</);
  });

  it('embeds images with alt text and falls back to the alt text', () => {
    const { text } = build(SAMPLE, 'Titel', true);
    const doc = text('word/document.xml');
    assert.match(doc, /<wp:extent cx="9525" cy="9525"\/><wp:docPr id="1" name="image1.png" descr="Ein Pixel"\/>/);
    assert.match(text('word/_rels/document.xml.rels'), /Target="media\/image1.png"/);
    assert.match(doc, /\[Bild: Fehlt\]/);
  });

  it('scales wide images to the text width', () => {
    const parts = markdownToDocx('![w](assets/wide.png)', 'T', {
      loadImage: () => ({ data: PIXEL_PNG, ext: 'png', width: 4000, height: 1000 }),
    });
    const doc = new TextDecoder().decode(parts.find((p) => p.path === 'word/document.xml')!.data);
    const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(doc)!;
    assert.equal(Number(cx), (11906 - 2 * 1134) * 635);
    assert.equal(Math.round(Number(cx) / Number(cy)), 4);
  });

  it('sets title and language', () => {
    const { text } = build('# x', 'Titel & Co');
    assert.match(text('docProps/core.xml'), /<dc:title>Titel &amp; Co<\/dc:title><dc:language>de-DE<\/dc:language>/);
    assert.match(text('word/styles.xml'), /<w:lang w:val="de-DE"/);
    setLocale('en');
    assert.match(build('# x').text('word/styles.xml'), /<w:lang w:val="en-US"/);
  });

  it('survives a round trip through the ZIP writer', () => {
    const { parts } = build(SAMPLE, 'T', true);
    const read = readZip(createZip(parts));
    assert.deepEqual(read.map((e) => e.path).sort(), parts.map((p) => p.path).sort());
  });

  it('removes characters XML does not allow', () => {
    assert.equal(xmlEscape('a\u0001b<c>&"'), 'ab&lt;c&gt;&amp;&quot;');
  });
});

describe('imageSize', () => {
  it('reads PNG', () => {
    assert.deepEqual(imageSize(PIXEL_PNG), { width: 1, height: 1 });
  });

  it('reads GIF', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02, 0, 0]);
    assert.deepEqual(imageSize(gif), { width: 800, height: 600 });
  });

  it('reads JPEG from the SOF segment', () => {
    // SOI, APP0 (length 4), SOF0 with height 480 and width 640.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0]);
    assert.deepEqual(imageSize(jpeg), { width: 640, height: 480 });
  });

  it('reads WebP (VP8X)', () => {
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    webp.set([99, 0, 0, 49, 0, 0], 24); // 100 × 50, stored minus one
    assert.deepEqual(imageSize(webp), { width: 100, height: 50 });
  });

  it('returns null for unknown data', () => {
    assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
  });
});

describe('markdownToHtmlDocument', () => {
  it('is a standalone page without scripts', () => {
    const html = markdownToHtmlDocument('# Hallo\n\n![Bild](assets/a.png)', 'Hallo <1>', {
      resolveImage: () => 'data:image/png;base64,AAAA',
    });
    assert.match(html, /^<!doctype html>\n<html lang="de" dir="ltr">/);
    assert.match(html, /<title>Hallo &lt;1&gt;<\/title>/);
    assert.match(html, /default-src 'none'; img-src data: https:/);
    assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Bild">/);
    assert.doesNotMatch(html, /<script/);
  });
});
