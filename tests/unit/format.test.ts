import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { applyFormat, shortcutLabel, type FormatKind, type FormatOutcome } from '../../src/renderer/editor/format';

/**
 * Notation: ‹…› marks the selection, ¦ marks a caret. The same marks are
 * used for the expected result, so every test checks text and selection.
 */
function parse(marked: string): EditorState {
  const open = marked.indexOf('‹');
  const caret = marked.indexOf('¦');
  if (open >= 0) {
    const close = marked.indexOf('›');
    const doc = marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1);
    return EditorState.create({ doc, selection: EditorSelection.single(open, close - 1) });
  }
  assert.ok(caret >= 0, 'test input needs a selection or caret');
  return EditorState.create({ doc: marked.replace('¦', ''), selection: EditorSelection.cursor(caret) });
}

function show(state: EditorState): string {
  const { from, to, empty } = state.selection.main;
  const doc = state.doc.toString();
  if (empty) return `${doc.slice(0, from)}¦${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

const labels = { tableColumn: 'Column' };

function run(kind: FormatKind, marked: string): { text: string; outcome: FormatOutcome } {
  const state = parse(marked);
  const outcome = applyFormat(state, kind, labels);
  return { text: show(state.update(outcome.spec).state), outcome };
}

const check = (kind: FormatKind, input: string, expected: string) => assert.equal(run(kind, input).text, expected);

describe('bold', () => {
  it('wraps a selection and keeps it selected', () => check('bold', 'a ‹word› b', 'a **‹word›** b'));
  it('removes the markers around the selection', () => check('bold', 'a **‹word›** b', 'a ‹word› b'));
  it('removes the markers when they are part of the selection', () => check('bold', 'a ‹**word**› b', 'a ‹word› b'));
  it('ignores spaces at the edges of the selection', () => check('bold', 'a‹ word ›b', 'a **‹word›** b'));
  it('wraps the word at the caret and keeps the caret in place', () => check('bold', 'one tw¦o three', 'one **tw¦o** three'));
  it('wraps a word when the caret is at its end', () => check('bold', 'one two¦ three', 'one **two¦** three'));
  it('wraps a word when the caret is at its start', () => check('bold', 'one ¦two three', 'one **¦two** three'));
  it('unwraps the word at the caret', () => check('bold', 'one **tw¦o** three', 'one tw¦o three'));
  it('inserts an empty pair on a blank spot and puts the caret inside', () => check('bold', 'one ¦ two', 'one **¦** two'));
  it('removes an empty pair', () => check('bold', 'x **¦** y', 'x ¦ y'));
  it('adds bold next to italic', () => check('bold', '*‹word›*', '***‹word›***'));
  it('removes only bold from bold italic', () => check('bold', '***‹word›***', '*‹word›*'));
  it('handles letters with accents', () => check('bold', 'Grüße¦', '**Grüße¦**'));
  it('wraps every line of a multi-line selection and skips list markers', () =>
    check('bold', '‹- one\n- two›', '- **‹one**\n- **two›**'));
  it('removes the markers from every line', () => check('bold', '- **‹one**\n- **two›**', '- ‹one\n- two›'));
  it('does not wrap blank lines in between', () => check('bold', '‹a\n\nb›', '**‹a**\n\n**b›**'));
  it('reports the new state', () => {
    assert.equal(run('bold', '‹a›').outcome.on, true);
    assert.equal(run('bold', '**‹a›**').outcome.on, false);
  });
});

describe('italic', () => {
  it('wraps with single asterisks', () => check('italic', '‹word›', '*‹word›*'));
  it('removes single asterisks', () => check('italic', '*‹word›*', '‹word›'));
  it('does not mistake bold for italic', () => check('italic', '**‹word›**', '***‹word›***'));
  it('removes italic from bold italic', () => check('italic', '***‹word›***', '**‹word›**'));
  it('works on the word at the caret', () => check('italic', 'a wo¦rd', 'a *wo¦rd*'));
  it('toggles an empty pair', () => {
    check('italic', '¦', '*¦*');
    check('italic', '*¦*', '¦');
  });
});

describe('strikethrough', () => {
  it('wraps with double tildes', () => check('strike', '‹word›', '~~‹word›~~'));
  it('removes double tildes', () => check('strike', '~~‹word›~~', '‹word›'));
  it('puts the caret inside an empty pair', () => check('strike', '¦', '~~¦~~'));
});

describe('inline code', () => {
  it('wraps a selection in backticks', () => check('code', 'use ‹npm ci› now', 'use `‹npm ci›` now'));
  it('removes backticks', () => check('code', 'use `‹npm ci›` now', 'use ‹npm ci› now'));
  it('wraps the word at the caret', () => check('code', 'a wo¦rd', 'a `wo¦rd`'));
});

describe('code block', () => {
  it('fences a multi-line selection', () => check('code', '‹a\nb›', '```\n‹a\nb›\n```'));
  it('removes the fences around the selected lines', () => check('code', '```\n‹a\nb›\n```', '‹a\nb›'));
  it('removes fences that have text after them', () => check('code', 'x\n```js\n‹a›\n```\ny', 'x\n‹a›\ny'));
  it('inserts an empty block on a blank line', () => check('code', 'x\n\n¦', 'x\n\n```\n¦\n```'));
  it('does not include the line a selection only ends at', () => check('code', '‹a\nb\n›c', '```\n‹a\nb›\n```\nc'));
});

describe('link', () => {
  it('wraps the selection and selects the url part', () => check('link', 'see ‹the docs› now', 'see [the docs](‹url›) now'));
  it('uses the word at the caret', () => check('link', 'see do¦cs now', 'see [docs](‹url›) now'));
  it('inserts an empty link at a blank spot', () => check('link', 'see ¦ now', 'see [¦]() now'));
  it('turns a selected address into the target', () => check('link', '‹https://example.org›', '[¦](https://example.org)'));
  it('removes the link around the selection and keeps the text', () => check('link', 'see [‹the docs›](https://x.y) now', 'see ‹the docs› now'));
  it('removes the link when the caret is inside', () => check('link', 'see [the d¦ocs](https://x.y) now', 'see the d¦ocs now'));
  it('moves a caret in the url to the end of the text', () => check('link', '[docs](ht¦tps://x.y)', 'docs¦'));
  it('leaves images alone', () => check('link', '![al¦t](a.png)', '![al¦t](a.png)'));
});

describe('heading', () => {
  it('cycles through levels 1 to 3 and off', () => {
    check('heading', 'Ti¦tle', '# Ti¦tle');
    check('heading', '# Ti¦tle', '## Ti¦tle');
    check('heading', '## Ti¦tle', '### Ti¦tle');
    check('heading', '### Ti¦tle', 'Ti¦tle');
  });
  it('removes deeper headings', () => check('heading', '#### Ti¦tle', 'Ti¦tle'));
  it('puts every selected line on the level of the first', () => check('heading', '‹# a\nb›', '‹## a\n## b›'));
  it('starts a heading on a blank line', () => check('heading', '¦', '# ¦'));
  it('reports the level', () => {
    assert.equal(run('heading', 'a¦').outcome.level, 1);
    assert.equal(run('heading', '### a¦').outcome.level, 0);
  });
});

describe('list and task', () => {
  it('makes bullets from lines', () => check('list', '‹one\ntwo›', '- ‹one\n- two›'));
  it('removes bullets again', () => check('list', '- ‹one\n- two›', '‹one\ntwo›'));
  it('keeps indentation', () => check('list', '  a¦', '  - a¦'));
  it('turns numbers into bullets', () => check('list', '1. a¦', '- a¦'));
  it('turns tasks into bullets', () => check('list', '- [ ] a¦', '- a¦'));
  it('skips blank lines in between', () => check('list', '‹a\n\nb›', '- ‹a\n\n- b›'));
  it('starts a list on a blank line', () => check('list', '¦', '- ¦'));
  it('makes tasks from lines', () => check('task', '‹one\ntwo›', '- [ ] ‹one\n- [ ] two›'));
  it('turns bullets into tasks', () => check('task', '- a¦', '- [ ] a¦'));
  it('removes tasks again, whether open or done', () => check('task', '- [ ] ‹a\n- [x] b›', '‹a\nb›'));
  it('keeps done tasks when the selection is mixed', () => check('task', '‹- [x] a\nb›', '‹- [x] a\n- [ ] b›'));
  it('uses the line of a caret at the end of a selected block, not the next one', () => check('list', '‹a\n›b', '- ‹a\n›b'));
});

describe('table', () => {
  const table = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |';
  it('is inserted after the line with a blank line before it', () => {
    const state = parse('text¦');
    const next = state.update(applyFormat(state, 'table', labels).spec).state;
    assert.equal(next.doc.toString(), `text\n\n${table}`);
    // The first header cell is selected so typing names the column.
    const { from, to } = next.selection.main;
    assert.equal(next.doc.sliceString(from, to), 'Column 1');
  });
  it('replaces a blank line and keeps blank lines around it', () => {
    const state = parse('a\n¦\nb');
    const next = state.update(applyFormat(state, 'table', labels).spec).state;
    assert.equal(next.doc.toString(), `a\n\n${table}\n\nb`);
  });
  it('does not add blank lines that are already there', () => {
    const state = parse('\n¦\n');
    const next = state.update(applyFormat(state, 'table', labels).spec).state;
    assert.equal(next.doc.toString(), `\n${table}\n`);
  });
  it('uses the translated column name', () => {
    const state = parse('¦');
    const next = state.update(applyFormat(state, 'table', { tableColumn: 'Spalte' }).spec).state;
    assert.match(next.doc.toString(), /^\| Spalte 1 \| Spalte 2 \|/);
  });
});

describe('shortcutLabel', () => {
  const names = { ctrl: 'Strg', shift: 'Umschalt' };
  it('uses symbols on macOS', () => {
    assert.equal(shortcutLabel('k', { mac: true, names }), '⌘K');
    assert.equal(shortcutLabel('x', { mac: true, shift: true, names }), '⇧⌘X');
  });
  it('spells out the keys elsewhere', () => {
    assert.equal(shortcutLabel('k', { mac: false, names }), 'Strg+K');
    assert.equal(shortcutLabel('x', { mac: false, shift: true, names }), 'Strg+Umschalt+X');
  });
});
