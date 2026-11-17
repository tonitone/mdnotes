import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shortenPath } from '../../src/renderer/format';

describe('shortenPath', () => {
  it('keeps short paths unchanged', () => {
    assert.equal(shortenPath('/home/me/notes', 28), '/home/me/notes');
  });

  it('cuts from the front and keeps the last folders', () => {
    const shortened = shortenPath('/Users/someone/Documents/Projects/notes', 20);
    assert.equal(shortened, '…/Projects/notes');
    assert.ok(shortened.length <= 20);
  });

  it('uses the Windows separator for Windows paths', () => {
    assert.equal(shortenPath('C:\\Users\\someone\\Documents\\Projects\\notes', 20), '…\\Projects\\notes');
  });

  it('cuts a single long folder name from the front', () => {
    const shortened = shortenPath(`/${'a'.repeat(60)}`, 28);
    assert.equal(shortened.length, 28);
    assert.ok(shortened.startsWith('…/'));
  });
});
