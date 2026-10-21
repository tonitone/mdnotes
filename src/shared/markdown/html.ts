import { parseMarkdown, type Block, type Inline } from './parse';

/** Renders Markdown to an HTML fragment (used for PDF export). */

export interface HtmlOptions {
  /** Maps an image `src` from the note to the URL used in the HTML. */
  resolveImage?: (src: string) => string;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Only allow link targets that cannot run code. */
function safeHref(href: string): string {
  return /^(https?:|mailto:|#|[^:]*$)/i.test(href.trim()) ? href : '#';
}

function renderInline(nodes: Inline[], opts: HtmlOptions): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return escapeHtml(n.value);
        case 'break':
          return '<br>';
        case 'code':
          return `<code>${escapeHtml(n.value)}</code>`;
        case 'strong':
          return `<strong>${renderInline(n.children, opts)}</strong>`;
        case 'em':
          return `<em>${renderInline(n.children, opts)}</em>`;
        case 'strike':
          return `<del>${renderInline(n.children, opts)}</del>`;
        case 'link':
          return `<a href="${escapeHtml(safeHref(n.href))}">${renderInline(n.children, opts)}</a>`;
        case 'image': {
          const src = opts.resolveImage ? opts.resolveImage(n.src) : n.src;
          return `<img src="${escapeHtml(src)}" alt="${escapeHtml(n.alt)}">`;
        }
      }
    })
    .join('');
}

function renderList(block: Extract<Block, { type: 'list' }>, opts: HtmlOptions): string {
  let html = '';
  const open: Array<'bullet' | 'ordered'> = [];
  const tag = (k: 'bullet' | 'ordered') => (k === 'bullet' ? 'ul' : 'ol');
  for (const item of block.items) {
    // Close lists that are deeper than (or differ from) this item's path.
    while (open.length > item.path.length || (open.length > 0 && open[open.length - 1] !== item.path[open.length - 1])) {
      html += `</li></${tag(open.pop()!)}>`;
    }
    if (open.length === item.path.length) html += '</li>';
    while (open.length < item.path.length) {
      const kind = item.path[open.length];
      html += `<${tag(kind)}>`;
      open.push(kind);
    }
    const box = item.checked === null ? '' : `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `;
    html += `<li${item.checked !== null ? ' class="task"' : ''}>${box}${renderInline(item.content, opts)}`;
  }
  while (open.length > 0) html += `</li></${tag(open.pop()!)}>`;
  return html;
}

function renderBlock(block: Block, opts: HtmlOptions): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${renderInline(block.content, opts)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${block.lines.map((l) => renderInline(l, opts)).join('<br>\n')}</p>`;
    case 'code':
      return `<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.text)}</code></pre>`;
    case 'quote':
      return `<blockquote>${block.children.map((b) => renderBlock(b, opts)).join('\n')}</blockquote>`;
    case 'list':
      return renderList(block, opts);
    case 'table': {
      const style = (i: number) => (block.align[i] ? ` style="text-align:${block.align[i]}"` : '');
      const head = block.header.map((c, i) => `<th${style(i)}>${renderInline(c, opts)}</th>`).join('');
      const rows = block.rows
        .map((r) => `<tr>${r.map((c, i) => `<td${style(i)}>${renderInline(c, opts)}</td>`).join('')}</tr>`)
        .join('\n');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'hr':
      return '<hr>';
  }
}

export function markdownToHtml(markdown: string, opts: HtmlOptions = {}): string {
  return parseMarkdown(markdown)
    .map((b) => renderBlock(b, opts))
    .join('\n');
}

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font-family: "72", "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1d2d3e; }
  h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.4em; }
  h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 12.5pt; }
  code, pre { font-family: "72Mono", Menlo, Consolas, monospace; font-size: 9.5pt; }
  code { background: #eff1f2; padding: 0 3px; border-radius: 3px; }
  pre { background: #f5f6f7; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #a9b4be; color: #556b82; }
  table { border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #a9b4be; padding: 4px 8px; }
  th { background: #eff1f2; }
  img { max-width: 100%; }
  li.task { list-style: none; margin-left: -1.2em; }
  a { color: #0064d9; }
`;

/** A complete, self-contained HTML document for printing to PDF. */
export function markdownToPrintDocument(markdown: string, title: string, opts: HtmlOptions = {}): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: mdnotes-asset:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${markdownToHtml(markdown, opts)}
</body>
</html>
`;
}
