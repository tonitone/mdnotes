import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keysLabel, SHORTCUT_GROUPS, strokeLabel } from '../../src/renderer/shortcuts';

const names = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };

describe('shortcut overview model', () => {
  it('formats strokes for macOS', () => {
    assert.equal(strokeLabel({ key: 'n', mod: true }, { mac: true, names }), '⌘N');
    assert.equal(strokeLabel({ key: 'x', mod: true, shift: true }, { mac: true, names }), '⇧⌘X');
    assert.equal(strokeLabel({ key: 'v', mod: true, alt: true }, { mac: true, names }), '⌥⌘V');
  });

  it('formats strokes for other platforms', () => {
    assert.equal(strokeLabel({ key: '/', mod: true }, { mac: false, names }), 'Ctrl+/');
    assert.equal(strokeLabel({ key: 'v', mod: true, alt: true }, { mac: false, names }), 'Ctrl+Alt+V');
    assert.equal(strokeLabel({ key: 'F6', shift: true }, { mac: false, names }), 'Shift+F6');
  });

  it('joins a sequence', () => {
    assert.equal(keysLabel([{ key: 'Esc' }, { key: 'Tab' }], { mac: false, names }), 'Esc, Tab');
  });

  it('has no empty group and no duplicate strokes', () => {
    const seen = new Set<string>();
    for (const group of SHORTCUT_GROUPS) {
      assert.ok(group.entries.length > 0);
      for (const entry of group.entries) {
        const label = keysLabel(entry.keys, { mac: false, names });
        assert.ok(!seen.has(label), `duplicate ${label}`);
        seen.add(label);
      }
    }
  });
});
