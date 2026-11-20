import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findBlockMath, findFootnoteMarks, findInlineMath } from '../../src/shared/markdown/math';

describe('findInlineMath', () => {
  it('finds inline formulas', () => {
    assert.deepEqual(findInlineMath('Euler: $e^{i\\pi}+1=0$ done'), [{ from: 7, to: 21, tex: 'e^{i\\pi}+1=0' }]);
  });

  it('ignores prices and escaped dollar signs', () => {
    assert.deepEqual(findInlineMath('It costs $5 and $6 or \\$7 and \\$8'), []);
  });

  it('finds several formulas in one line', () => {
    assert.deepEqual(
      findInlineMath('$a$ und $b$').map((m) => m.tex),
      ['a', 'b'],
    );
  });
});

describe('findBlockMath', () => {
  it('finds one-line and multi-line blocks', () => {
    const lines = ['$$ x^2 $$', 'text', '$$', '\\frac{a}{b}', '=c', '$$'];
    assert.deepEqual(findBlockMath(lines), [
      { start: 0, end: 0, tex: 'x^2' },
      { start: 2, end: 5, tex: '\\frac{a}{b}\n=c' },
    ]);
  });

  it('ignores an unclosed block', () => {
    assert.deepEqual(findBlockMath(['$$', 'x']), []);
  });
});

describe('findFootnoteMarks', () => {
  it('marks references and definition labels', () => {
    assert.deepEqual(findFootnoteMarks('Hi[^1] there'), [{ from: 2, to: 6, definition: false }]);
    assert.deepEqual(findFootnoteMarks('[^1]: Note[^2]'), [
      { from: 0, to: 4, definition: true },
      { from: 10, to: 14, definition: false },
    ]);
  });
});
