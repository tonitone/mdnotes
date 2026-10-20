import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  UNTITLED,
  fileNameFor,
  isNoteId,
  newId,
  parseNote,
  previewFromBody,
  serializeNote,
  slugify,
  titleFromBody,
} from '../../src/shared/note';

describe('newId', () => {
  it('creates valid, unique ULIDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    assert.equal(ids.size, 1000);
    for (const id of ids) assert.ok(isNoteId(id), id);
  });

  it('is sortable by creation time', () => {
    const a = newId(Date.UTC(2026, 0, 1));
    const b = newId(Date.UTC(2026, 9, 19));
    assert.ok(a < b);
  });
});

describe('slugify and fileNameFor', () => {
  it('converts umlauts and special characters', () => {
    assert.equal(slugify('Größe & Übersicht: Straße!'), 'groesse-uebersicht-strasse');
    assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  });

  it('falls back for empty titles', () => {
    assert.equal(slugify('!!!'), 'notiz');
    assert.equal(slugify('日本語'), 'notiz');
  });

  it('truncates long titles without a trailing hyphen', () => {
    const slug = slugify('a '.repeat(100));
    assert.ok(slug.length <= 60);
    assert.ok(!slug.endsWith('-'));
  });

  it('appends the last 6 characters of the ID in lower case', () => {
    const id = '01JAB3K9ZZ4QWERTYVPASD1234';
    assert.equal(fileNameFor('Meeting Notizen', id), 'meeting-notizen--sd1234.md');
  });

  it('creates different file names for equal titles', () => {
    assert.notEqual(fileNameFor('Gleich', newId()), fileNameFor('Gleich', newId()));
  });
});

describe('titleFromBody', () => {
  it('takes the first non-empty line without Markdown', () => {
    assert.equal(titleFromBody('\n\n# **Einkauf** für [Samstag](https://x.de)\nMilch'), 'Einkauf für Samstag');
  });

  it('removes list and task markers', () => {
    assert.equal(titleFromBody('- [ ] Steuer machen'), 'Steuer machen');
  });

  it('returns the untitled title for empty content or code only', () => {
    assert.equal(titleFromBody(''), UNTITLED);
    assert.equal(titleFromBody('```js\nconst a = 1;\n```'), UNTITLED);
  });
});

describe('previewFromBody', () => {
  it('skips the title and code fences', () => {
    assert.equal(previewFromBody('# Titel\n\nErste Zeile\n```\ncode\n```'), 'Erste Zeile code');
  });

  it('truncates with an ellipsis', () => {
    const preview = previewFromBody('T\n' + 'wort '.repeat(100), 20);
    assert.ok(preview.length <= 20);
    assert.ok(preview.endsWith('…'));
  });
});

describe('Front Matter', () => {
  const id = '01JAB3K9ZZ4QWERTYVPASD1234';

  it('reads own fields and keeps foreign lines verbatim', () => {
    const text = [
      '---',
      'title: Alter Titel',
      `id: ${id}`,
      'labels: [arbeit, "mit leer zeichen"]',
      'created: 2026-10-19T12:00:00.000Z',
      'custom:',
      '  nested: true',
      '---',
      '# Hallo',
    ].join('\n');
    const parsed = parseNote(text);
    assert.equal(parsed.meta.id, id);
    assert.deepEqual(parsed.meta.labels, ['arbeit', 'mit leer zeichen']);
    assert.deepEqual(parsed.extraFrontMatter, ['title: Alter Titel', 'custom:', '  nested: true']);
    assert.equal(parsed.body, '# Hallo');
  });

  it('understands labels as a block list', () => {
    const parsed = parseNote(`---\nid: ${id}\nlabels:\n  - a\n  - b\n---\nText`);
    assert.deepEqual(parsed.meta.labels, ['a', 'b']);
  });

  it('round-trips without loss', () => {
    const meta = { id, labels: ['arbeit', 'idee: neu'], created: '2026-10-19T12:00:00.000Z' };
    const text = serializeNote(meta, '# Titel\n\nText\n', ['custom: 1']);
    const parsed = parseNote(text);
    assert.deepEqual(parsed.meta, meta);
    assert.deepEqual(parsed.extraFrontMatter, ['custom: 1']);
    assert.equal(parsed.body, '# Titel\n\nText\n');
  });

  it('normalizes CRLF and BOM', () => {
    const parsed = parseNote(`﻿---\r\nid: ${id}\r\n---\r\nZeile 1\r\nZeile 2`);
    assert.equal(parsed.meta.id, id);
    assert.equal(parsed.body, 'Zeile 1\nZeile 2');
  });

  it('ignores invalid IDs', () => {
    assert.equal(parseNote('---\nid: abc\n---\nText').meta.id, undefined);
  });

  it('treats files without front matter as plain text', () => {
    const parsed = parseNote('# Nur Text\n---\nkein Front Matter');
    assert.deepEqual(parsed.meta, {});
    assert.equal(parsed.body, '# Nur Text\n---\nkein Front Matter');
  });

  it('treats unclosed front matter as text', () => {
    const text = '---\nid: x\nkein Ende';
    assert.equal(parseNote(text).body, text);
  });
});
