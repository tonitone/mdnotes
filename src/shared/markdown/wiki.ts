import { parseMarkdown, type Block, type Inline } from './parse';

/**
 * Converts Markdown into classic Jira/Confluence wiki markup
 * (Jira Server/Data Center text formatting, Confluence "Insert > Markup").
 *
 * Deliberate choices:
 * - Line breaks inside a paragraph are kept, because wiki markup renders
 *   them and notes are usually written line by line.
 * - Task list items become ☐ / ☑, because wiki markup has no checkboxes.
 * - Local images become `!file.png|alt=...!`; the file has to be attached
 *   to the issue or page separately.
 */

/** Code macro languages supported by Jira and Confluence, plus aliases. */
const CODE_LANGUAGES: Record<string, string> = {
  actionscript: 'actionscript', ada: 'ada', applescript: 'applescript', bash: 'bash', sh: 'bash', shell: 'bash',
  zsh: 'bash', c: 'c', 'c#': 'c#', cs: 'c#', csharp: 'c#', 'c++': 'c++', cpp: 'c++', css: 'css',
  erlang: 'erlang', go: 'go', groovy: 'groovy', haskell: 'haskell', html: 'html', java: 'java',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', typescript: 'javascript', ts: 'javascript',
  tsx: 'javascript', json: 'json', lua: 'lua', objc: 'objc', perl: 'perl', php: 'php', python: 'python',
  py: 'python', r: 'r', ruby: 'ruby', rb: 'ruby', scala: 'scala', sql: 'sql', swift: 'swift', vb: 'visualbasic',
  visualbasic: 'visualbasic', xml: 'xml', yaml: 'yaml', yml: 'yaml',
};

/** Characters that start or end wiki formatting and must be escaped in text. */
const ALWAYS_ESCAPE = /[{}[\]|!*_^~+]/g;

function escapeText(text: string): string {
  return (
    text
      .replace(ALWAYS_ESCAPE, (c) => `\\${c}`)
      // "-" only where it could open or close strikethrough.
      .replace(/(^|\s)-(?=\S)/g, '$1\\-')
      .replace(/(\S)-(?=\s|$)/g, '$1\\-')
      // "??" opens a citation.
      .replace(/\?\?/g, '\\?\\?')
  );
}

/** Escapes characters that are only special at the start of a line. */
function escapeLineStart(line: string): string {
  return line.replace(/^(#|h[1-6]\.|bq\.|-{4,})/, (m) => `\\${m}`);
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

function fileName(src: string): string {
  const clean = src.split(/[?#]/)[0];
  return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1));
}

function renderInline(nodes: Inline[]): string {
  let out = '';
  nodes.forEach((node, index) => {
    switch (node.type) {
      case 'text':
        out += escapeText(node.value);
        break;
      case 'break':
        out += '\n';
        break;
      case 'code':
        out += `{{${node.value.replace(/[{}]/g, (c) => `\\${c}`)}}}`;
        break;
      case 'strong':
      case 'em':
      case 'strike': {
        const mark = node.type === 'strong' ? '*' : node.type === 'em' ? '_' : '-';
        const inner = renderInline(node.children);
        const next = nodes[index + 1];
        const nextChar = next?.type === 'text' ? next.value[0] : undefined;
        // Wiki markup only formats at word boundaries; {*}x{*} works anywhere.
        const glued = isWordChar(out[out.length - 1]) || isWordChar(nextChar);
        out += glued ? `{${mark}}${inner}{${mark}}` : `${mark}${inner}${mark}`;
        break;
      }
      case 'link': {
        const label = renderInline(node.children);
        const href = node.href.replace(/[|\]]/g, encodeURIComponent);
        out += label && label !== escapeText(node.href) ? `[${label}|${href}]` : `[${href}]`;
        break;
      }
      case 'image': {
        const src = /^[a-z]+:/i.test(node.src) ? node.src : fileName(node.src);
        const alt = node.alt.replace(/[|!]/g, '');
        out += alt ? `!${src}|alt=${alt}!` : `!${src}!`;
        break;
      }
    }
  });
  return out;
}

function renderCell(nodes: Inline[]): string {
  return renderInline(nodes).replace(/\n/g, ' ') || ' ';
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `h${block.level}. ${renderInline(block.content)}`;
    case 'paragraph':
      return block.lines.map((l) => escapeLineStart(renderInline(l))).join('\n');
    case 'code': {
      const lang = CODE_LANGUAGES[block.lang.toLowerCase()];
      const open = lang ? `{code:language=${lang}}` : block.lang ? '{noformat}' : '{code}';
      const close = lang || !block.lang ? '{code}' : '{noformat}';
      return `${open}\n${block.text}\n${close}`;
    }
    case 'quote':
      return `{quote}\n${block.children.map(renderBlock).join('\n\n')}\n{quote}`;
    case 'list':
      return block.items
        .map((item) => {
          const markers = item.path.map((k) => (k === 'bullet' ? '*' : '#')).join('');
          const box = item.checked === null ? '' : item.checked ? '☑ ' : '☐ ';
          // Continuation lines of an item must not start a new paragraph.
          const text = renderInline(item.content).replace(/\n/g, '\\\\ ');
          return `${markers} ${box}${text}`;
        })
        .join('\n');
    case 'table': {
      const head = `||${block.header.map(renderCell).join('||')}||`;
      const rows = block.rows.map((r) => `|${r.map(renderCell).join('|')}|`);
      return [head, ...rows].join('\n');
    }
    case 'hr':
      return '----';
  }
}

export function markdownToWiki(markdown: string): string {
  return parseMarkdown(markdown).map(renderBlock).join('\n\n') + '\n';
}
