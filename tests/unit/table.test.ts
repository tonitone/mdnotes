import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { editTable, isDelimiterRow, isTableLine } from '../../src/renderer/editor/table';

/** The selected text of an edit, to check where the caret lands. */
const selected = (edit: { text: string; from: number; to: number }) => edit.text.slice(edit.from, edit.to);

describe('table detection', () => {
  it('knows table lines and delimiter rows', () => {
    assert.ok(isTableLine('| a | b |'));
    assert.ok(isTableLine('  | a'));
    assert.ok(!isTableLine('a | b'));
    assert.ok(isDelimiterRow('| --- | :-: |'));
    assert.ok(isDelimiterRow('|---|---:|'));
    assert.ok(!isDelimiterRow('| a | --- |'));
  });

  it('returns null without a delimiter row', () => {
    assert.equal(editTable(['| a | b |', '| c | d |'], 0, 2, 'next'), null);
    assert.equal(editTable(['| a | b |'], 0, 2, 'next'), null);
  });
});

describe('table alignment', () => {
  const table = ['| Name | Age |', '| --- | --- |', '| Alexander | 7 |'];

  it('pads every column to its widest cell', () => {
    const edit = editTable(table, 0, 3, 'next')!;
    assert.equal(edit.text, ['| Name      | Age |', '| --------- | --- |', '| Alexander | 7   |'].join('\n'));
  });

  it('keeps column alignment markers', () => {
    const edit = editTable(['| a | b | c |', '| :--- | :-: | ---: |', '| 1 | 2 | 3 |'], 0, 2, 'next')!;
    assert.equal(edit.text, ['| a   |  b  |   c |', '| :-- | :-: | --: |', '| 1   |  2  |   3 |'].join('\n'));
  });

  it('adds missing cells and keeps the indent', () => {
    const edit = editTable(['  | a | b |', '  | - | - |', '  | x |'], 2, 5, 'next')!;
    assert.equal(edit.text, ['  | a   | b   |', '  | --- | --- |', '  | x   |     |'].join('\n'));
  });

  it('keeps escaped pipes inside a cell', () => {
    const edit = editTable(['| a\\|b | c |', '| --- | --- |'], 0, 2, 'next')!;
    assert.equal(edit.text.split('\n')[0], '| a\\|b | c   |');
    assert.equal(selected(edit), 'c');
  });
});

describe('Tab and Shift+Tab', () => {
  const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];

  it('moves to the next cell and selects its content', () => {
    const edit = editTable(table, 0, 3, 'next')!;
    assert.equal(selected(edit), 'B');
  });

  it('wraps to the first cell of the next row and skips the delimiter row', () => {
    const edit = editTable(table, 0, 7, 'next')!;
    assert.equal(selected(edit), '1');
    assert.equal(edit.text.slice(0, edit.from).split('\n').length, 3);
  });

  it('adds a row at the end of the last row', () => {
    const edit = editTable(table, 2, 8, 'next')!;
    assert.equal(edit.text.split('\n').length, 4);
    assert.equal(edit.text.split('\n')[3], '|     |     |');
    assert.equal(edit.from, edit.to);
    assert.equal(edit.text.slice(0, edit.from).split('\n').length, 4);
  });

  it('treats the delimiter row like the header', () => {
    assert.equal(selected(editTable(table, 1, 3, 'next')!), 'B');
  });

  it('moves back, over the row start and the delimiter row', () => {
    assert.equal(selected(editTable(table, 0, 7, 'previous')!), 'A');
    assert.equal(selected(editTable(table, 2, 3, 'previous')!), 'B');
    assert.equal(editTable(table, 2, 3, 'previous')!.text.slice(0, editTable(table, 2, 3, 'previous')!.from).split('\n').length, 1);
  });

  it('stays in the first cell on Shift+Tab there', () => {
    assert.equal(selected(editTable(table, 0, 2, 'previous')!), 'A');
  });

  it('counts wide characters by code points', () => {
    const edit = editTable(['| 😀 | b |', '| --- | --- |'], 0, 3, 'next')!;
    assert.equal(edit.text.split('\n')[0], '| 😀   | b   |');
    assert.equal(selected(edit), 'b');
  });
});

describe('Enter', () => {
  const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'];

  it('inserts a row below the current one, caret in its first cell', () => {
    const edit = editTable(table, 2, 4, 'newRow')!;
    const lines = edit.text.split('\n');
    assert.equal(lines.length, 5);
    assert.equal(lines[3], '|     |     |');
    assert.equal(lines[4], '| 3   | 4   |');
    assert.equal(edit.from, edit.to);
    assert.equal(edit.text.slice(0, edit.from).split('\n').length, 4);
  });

  it('inserts below the delimiter row from the header', () => {
    const lines = editTable(table, 0, 4, 'newRow')!.text.split('\n');
    assert.equal(lines[2], '|     |     |');
    assert.equal(lines[3], '| 1   | 2   |');
  });
});
