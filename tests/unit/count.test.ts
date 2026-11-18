import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countText } from '../../src/shared/markdown/count';

describe('countText', () => {
  it('counts nothing for an empty note', () => {
    assert.deepEqual(countText(''), { words: 0, chars: 0 });
  });

  it('counts words across lines and ignores markers', () => {
    const body = '# Title here\n\n- one\n- two\n\n| a | b |\n|---|---|\n';
    assert.equal(countText(body).words, 6);
  });

  it('counts characters without line breaks and by code point', () => {
    assert.deepEqual(countText('ab\r\ncd'), { words: 2, chars: 4 });
    assert.equal(countText('😀 x').chars, 3);
  });

  it('counts words with umlauts and digits', () => {
    assert.equal(countText('Größe 42 – äöü').words, 3);
  });
});
