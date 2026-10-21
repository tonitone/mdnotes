import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownToHtml, markdownToPrintDocument } from '../../src/shared/markdown/html';
import { parseInline, parseMarkdown } from '../../src/shared/markdown/parse';
import { markdownToWiki } from '../../src/shared/markdown/wiki';

describe('parseInline', () => {
  it('parses nested emphasis, code and links', () => {
    assert.deepEqual(parseInline('a **b _c_** `d*e` [f](g "t")'), [
      { type: 'text', value: 'a ' },
      { type: 'strong', children: [{ type: 'text', value: 'b ' }, { type: 'em', children: [{ type: 'text', value: 'c' }] }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'd*e' },
      { type: 'text', value: ' ' },
      { type: 'link', href: 'g', children: [{ type: 'text', value: 'f' }] },
    ]);
  });

  it('does not treat intraword underscores as emphasis', () => {
    assert.deepEqual(parseInline('snake_case_name'), [{ type: 'text', value: 'snake_case_name' }]);
  });

  it('keeps unmatched delimiters and escaped characters as text', () => {
    assert.deepEqual(parseInline('2 * 3 and \\*no\\*'), [{ type: 'text', value: '2 * 3 and *no*' }]);
  });

  it('parses images and autolinks', () => {
    assert.deepEqual(parseInline('![Logo](assets/a.png) <https://x.de>'), [
      { type: 'image', alt: 'Logo', src: 'assets/a.png' },
      { type: 'text', value: ' ' },
      { type: 'link', href: 'https://x.de', children: [{ type: 'text', value: 'https://x.de' }] },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('recognizes all block types', () => {
    const blocks = parseMarkdown(
      ['# T', '', 'p1', 'p2', '', '```ts', 'x', '```', '> q', '', '- a', '  - b', '1. c', '', '| h |', '|---|', '| v |', '', '---'].join('\n'),
    );
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['heading', 'paragraph', 'code', 'quote', 'list', 'table', 'hr'],
    );
  });

  it('builds list paths for nesting and mixed kinds', () => {
    const [list] = parseMarkdown('- a\n    1. b\n    2. c\n- [x] d');
    assert.equal(list.type, 'list');
    if (list.type !== 'list') return;
    assert.deepEqual(
      list.items.map((i) => [i.path.join('/'), i.checked]),
      [
        ['bullet', null],
        ['bullet/ordered', null],
        ['bullet/ordered', null],
        ['bullet', true],
      ],
    );
  });

  it('treats a rule of dashes as hr, not as a list', () => {
    assert.deepEqual(
      parseMarkdown('- - -').map((b) => b.type),
      ['hr'],
    );
  });

  it('keeps an unclosed code fence until the end', () => {
    const [code] = parseMarkdown('```\na\nb');
    assert.deepEqual(code, { type: 'code', lang: '', text: 'a\nb' });
  });
});

describe('markdownToWiki', () => {
  it('converts headings, emphasis and code', () => {
    assert.equal(markdownToWiki('# Titel\n\n**fett** _kursiv_ ~~weg~~ `x`'), 'h1. Titel\n\n*fett* _kursiv_ -weg- {{x}}\n');
  });

  it('uses brace syntax for formatting inside words', () => {
    assert.equal(markdownToWiki('vor**fett**nach'), 'vor{*}fett{*}nach\n');
  });

  it('converts nested and task lists', () => {
    assert.equal(markdownToWiki('- a\n  1. b\n- [ ] c\n- [x] d'), '* a\n*# b\n* ☐ c\n* ☑ d\n');
  });

  it('converts links and images', () => {
    assert.equal(
      markdownToWiki('[SAP](https://sap.com) <https://x.de> ![Logo](assets/ab%20c.png)'),
      '[SAP|https://sap.com] [https://x.de] !ab c.png|alt=Logo!\n',
    );
  });

  it('maps code languages and falls back to noformat', () => {
    assert.equal(markdownToWiki('```ts\na\n```'), '{code:language=javascript}\na\n{code}\n');
    assert.equal(markdownToWiki('```\na\n```'), '{code}\na\n{code}\n');
    assert.equal(markdownToWiki('```brainfuck\n+\n```'), '{noformat}\n+\n{noformat}\n');
  });

  it('does not escape inside code blocks', () => {
    assert.equal(markdownToWiki('```js\nconst a = { b: [1] } * 2;\n```'), '{code:language=javascript}\nconst a = { b: [1] } * 2;\n{code}\n');
  });

  it('converts tables, quotes and rules', () => {
    assert.equal(markdownToWiki('| A | B |\n|---|:-:|\n| 1 | 2 |'), '||A||B||\n|1|2|\n');
    assert.equal(markdownToWiki('> zitat'), '{quote}\nzitat\n{quote}\n');
    assert.equal(markdownToWiki('***'), '----\n');
  });

  it('escapes characters that would start wiki formatting', () => {
    assert.equal(markdownToWiki('a {b} [c] x|y 2^3 -minus- E-Mail'), 'a \\{b\\} \\[c\\] x\\|y 2\\^3 \\-minus\\- E-Mail\n');
    assert.equal(markdownToWiki('\\# no heading'), '\\# no heading\n');
    assert.equal(markdownToWiki('h1. text'), '\\h1. text\n');
  });

  it('keeps line breaks within a paragraph', () => {
    assert.equal(markdownToWiki('eins\nzwei'), 'eins\nzwei\n');
  });
});

describe('markdownToHtml', () => {
  it('escapes text and renders blocks', () => {
    assert.equal(markdownToHtml('# A & B\n\n<script>x</script>'), '<h1>A &amp; B</h1>\n<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('renders nested lists with correct closing tags', () => {
    assert.equal(
      markdownToHtml('- a\n  1. b\n- c'),
      '<ul><li>a<ol><li>b</li></ol></li><li>c</li></ul>',
    );
  });

  it('renders task items as disabled checkboxes', () => {
    assert.equal(markdownToHtml('- [x] done'), '<ul><li class="task"><input type="checkbox" disabled checked> done</li></ul>');
  });

  it('neutralizes javascript links and resolves images', () => {
    const html = markdownToHtml('[x](javascript:alert(1)) ![a](assets/i.png)', { resolveImage: (s) => `file:///w/${s}` });
    assert.match(html, /href="#"/);
    assert.match(html, /src="file:\/\/\/w\/assets\/i.png"/);
  });

  it('wraps the print document with title and CSP', () => {
    const doc = markdownToPrintDocument('# T', 'Titel <1>');
    assert.match(doc, /<title>Titel &lt;1&gt;<\/title>/);
    assert.match(doc, /Content-Security-Policy/);
  });
});
