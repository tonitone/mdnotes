import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractOutline } from '../../src/shared/markdown/outline';

describe('extractOutline', () => {
  it('lists headings with level, text and offset', () => {
    const doc = '# Title\n\nText\n\n## Part **one**\n';
    assert.deepEqual(extractOutline(doc), [
      { level: 1, text: 'Title', offset: 0 },
      { level: 2, text: 'Part one', offset: doc.indexOf('## ') },
    ]);
  });

  it('ignores headings inside fenced code', () => {
    const doc = '# A\n```md\n# not a heading\n```\n~~~\n## nor this\n~~~\n## B';
    assert.deepEqual(extractOutline(doc).map((e) => e.text), ['A', 'B']);
  });

  it('keeps a longer fence open until a matching close', () => {
    const doc = '````\n```\n# inside\n````\n# out';
    assert.deepEqual(extractOutline(doc).map((e) => e.text), ['out']);
  });

  it('handles closing hashes, CRLF and empty headings', () => {
    const doc = '# One ##\r\n#\r\n####### seven\r\n### Three\r\n';
    assert.deepEqual(extractOutline(doc).map((e) => [e.level, e.text]), [[1, 'One'], [3, 'Three']]);
  });

  it('needs a space after the hashes', () => {
    assert.deepEqual(extractOutline('#hashtag\n'), []);
  });

  it('returns nothing for a note without headings', () => {
    assert.deepEqual(extractOutline('just text'), []);
  });
});
