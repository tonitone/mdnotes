import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createdTime,
  dateGroup,
  groupNotes,
  isNoteSort,
  sortNotes,
  type DateGroup,
  type ListedNote,
} from '../../src/shared/note-list';

let seq = 0;
function note(title: string, modified: string | number, extra: Partial<ListedNote> = {}): ListedNote {
  seq++;
  return {
    id: `01JAB3K9ZZ4QWERTYVPASD${String(seq).padStart(4, '0')}`,
    title,
    modified: typeof modified === 'number' ? modified : Date.parse(modified),
    created: typeof modified === 'number' ? new Date(modified).toISOString() : modified,
    pinned: false,
    ...extra,
  };
}

const titles = (notes: ListedNote[]) => notes.map((n) => n.title);

describe('sortNotes', () => {
  const a = note('Banane', '2026-10-20T10:00:00Z', { created: '2026-01-01T00:00:00Z' });
  const b = note('apfel', '2026-10-25T10:00:00Z', { created: '2026-03-01T00:00:00Z' });
  const c = note('Ähre', '2026-10-22T10:00:00Z', { created: '2025-12-01T00:00:00Z' });
  const d = note('Notiz 10', '2026-10-01T10:00:00Z', { created: '2026-02-01T00:00:00Z' });
  const e = note('Notiz 9', '2026-10-02T10:00:00Z', { created: '2026-02-02T00:00:00Z' });

  it('sorts by modification date, newest first', () => {
    assert.deepEqual(titles(sortNotes([a, b, c, d, e], 'modified')), ['apfel', 'Ähre', 'Banane', 'Notiz 9', 'Notiz 10']);
  });

  it('sorts by creation date, newest first', () => {
    assert.deepEqual(titles(sortNotes([a, b, c, d, e], 'created')), ['apfel', 'Notiz 9', 'Notiz 10', 'Banane', 'Ähre']);
  });

  it('sorts by title A to Z, ignoring case and accents, numbers in natural order', () => {
    assert.deepEqual(titles(sortNotes([a, b, c, d, e], 'title', 'de')), ['Ähre', 'apfel', 'Banane', 'Notiz 9', 'Notiz 10']);
  });

  it('puts pinned notes first in every order', () => {
    const pinned = { ...d, pinned: true };
    for (const sort of ['modified', 'created', 'title'] as const) {
      assert.equal(sortNotes([a, b, c, pinned, e], sort, 'de')[0], pinned, sort);
    }
  });

  it('does not change the input and is stable for equal keys', () => {
    const input = [a, b];
    sortNotes(input, 'title');
    assert.deepEqual(input, [a, b]);
    const x = note('Gleich', 1000);
    const y = note('Gleich', 1000);
    assert.deepEqual(sortNotes([x, y], 'modified'), sortNotes([y, x], 'modified'));
  });

  it('falls back to the modification time for an unreadable created date', () => {
    const bad = note('Kaputt', '2026-10-26T10:00:00Z', { created: 'irgendwann' });
    assert.equal(createdTime(bad), bad.modified);
    assert.equal(sortNotes([a, bad], 'created')[0], bad);
  });

  it('knows its sort keys', () => {
    assert.ok(isNoteSort('title'));
    assert.ok(!isNoteSort('size'));
    assert.ok(!isNoteSort(undefined));
  });
});

describe('dateGroup', () => {
  const berlin = 'Europe/Berlin';
  // Tuesday, 27 October 2026, 12:00 in Berlin (CET, UTC+1 since 25 October).
  const now = Date.parse('2026-10-27T11:00:00Z');
  const at = (iso: string) => dateGroup(Date.parse(iso), now, berlin);

  it('today, yesterday, previous 7 and previous 30 days', () => {
    assert.deepEqual(at('2026-10-27T10:00:00Z'), { kind: 'today' });
    assert.deepEqual(at('2026-10-26T10:00:00Z'), { kind: 'yesterday' });
    assert.deepEqual(at('2026-10-25T10:00:00Z'), { kind: 'previous7' });
    assert.deepEqual(at('2026-10-20T10:00:00Z'), { kind: 'previous7' }, '7 days ago');
    assert.deepEqual(at('2026-10-19T10:00:00Z'), { kind: 'previous30' }, '8 days ago');
    assert.deepEqual(at('2026-09-27T10:00:00Z'), { kind: 'previous30' }, '30 days ago');
    assert.deepEqual(at('2026-09-26T10:00:00Z'), { kind: 'month', year: 2026, month: 9 }, '31 days ago');
  });

  it('months of the current year, then years', () => {
    assert.deepEqual(at('2026-01-15T10:00:00Z'), { kind: 'month', year: 2026, month: 1 });
    assert.deepEqual(at('2025-12-31T10:00:00Z'), { kind: 'year', year: 2025 });
    assert.deepEqual(at('2019-06-01T10:00:00Z'), { kind: 'year', year: 2019 });
  });

  it('a date in the future counts as today', () => {
    assert.deepEqual(at('2026-10-29T10:00:00Z'), { kind: 'today' });
  });

  it('uses the calendar day of the time zone at midnight', () => {
    // 23:30 UTC on the 26th is already 00:30 on the 27th in Berlin, but still the 26th in UTC.
    const lateUtc = Date.parse('2026-10-26T23:30:00Z');
    assert.deepEqual(dateGroup(lateUtc, now, berlin), { kind: 'today' });
    assert.deepEqual(dateGroup(lateUtc, now, 'UTC'), { kind: 'yesterday' });
    // One minute before midnight in Berlin is yesterday, one minute after is today.
    assert.deepEqual(at('2026-10-26T22:59:00Z'), { kind: 'yesterday' });
    assert.deepEqual(at('2026-10-26T23:01:00Z'), { kind: 'today' });
  });

  it('counts calendar days, not 24-hour spans, across daylight saving changes', () => {
    // Berlin went from CEST to CET on 25 October 2026 (a 25-hour day).
    const autumn = Date.parse('2026-10-26T23:05:00Z'); // 00:05 CET on the 27th
    assert.deepEqual(dateGroup(Date.parse('2026-10-25T22:10:00Z'), autumn, berlin), { kind: 'previous7' }, '23:10 on the 25th, under 25 hours ago');
    assert.deepEqual(dateGroup(Date.parse('2026-10-25T23:30:00Z'), autumn, berlin), { kind: 'yesterday' }, '00:30 on the 26th');
    // And from CET to CEST on 29 March 2026 (a 23-hour day).
    const spring = Date.parse('2026-03-29T22:30:00Z'); // 00:30 CEST on the 30th
    assert.deepEqual(dateGroup(Date.parse('2026-03-28T23:45:00Z'), spring, berlin), { kind: 'yesterday' }, '00:45 on the 29th, under 23 hours ago');
  });

  it('month boundary: the last evening of a month in a zone west of UTC', () => {
    const la = 'America/Los_Angeles';
    // 1 December 2026, 07:00 UTC is still 30 November, 23:00 in Los Angeles.
    const nowLa = Date.parse('2026-12-01T07:00:00Z');
    assert.deepEqual(dateGroup(Date.parse('2026-11-30T20:00:00Z'), nowLa, la), { kind: 'today' });
    assert.deepEqual(dateGroup(Date.parse('2026-10-01T18:00:00Z'), nowLa, la), { kind: 'month', year: 2026, month: 10 });
    // 31 October 12:00 UTC: 30 days back in Los Angeles, but 31 days (October) in UTC.
    const lastOctober = Date.parse('2026-10-31T12:00:00Z');
    assert.deepEqual(dateGroup(lastOctober, nowLa, la), { kind: 'previous30' });
    assert.deepEqual(dateGroup(lastOctober, nowLa, 'UTC'), { kind: 'month', year: 2026, month: 10 });
  });

  it('year boundary: New Year in Kiritimati (UTC+14) and in UTC', () => {
    const kiritimati = 'Pacific/Kiritimati';
    // 31 December 2026, 10:30 UTC is already 1 January 2027, 00:30 in Kiritimati.
    const newYear = Date.parse('2026-12-31T10:30:00Z');
    const midYear = Date.parse('2026-06-15T12:00:00Z');
    assert.deepEqual(dateGroup(midYear, newYear, kiritimati), { kind: 'year', year: 2026 });
    assert.deepEqual(dateGroup(midYear, newYear, 'UTC'), { kind: 'month', year: 2026, month: 6 });
    // The evening before is yesterday, even though it was last year.
    assert.deepEqual(dateGroup(Date.parse('2026-12-31T08:00:00Z'), newYear, kiritimati), { kind: 'yesterday' });
  });
});

describe('groupNotes', () => {
  const now = Date.parse('2026-10-27T11:00:00Z');
  const tz = 'UTC';
  const kinds = (groups: Array<{ group: DateGroup }>) => groups.map((g) => g.group.kind);

  it('pinned first, then the date groups in order, empty groups left out', () => {
    const notes = sortNotes(
      [
        note('Heute', '2026-10-27T09:00:00Z'),
        note('Angeheftet alt', '2020-01-01T00:00:00Z', { pinned: true }),
        note('Gestern', '2026-10-26T09:00:00Z'),
        note('März', '2026-03-10T09:00:00Z'),
        note('Februar', '2026-02-10T09:00:00Z'),
        note('Alt', '2024-05-01T09:00:00Z'),
        note('Älter', '2023-05-01T09:00:00Z'),
      ],
      'modified',
    );
    const groups = groupNotes(notes, 'modified', now, tz);
    assert.deepEqual(kinds(groups), ['pinned', 'today', 'yesterday', 'month', 'month', 'year', 'year']);
    assert.deepEqual(groups.map((g) => g.key), ['pinned', 'today', 'yesterday', 'month-2026-03', 'month-2026-02', 'year-2024', 'year-2023']);
    assert.deepEqual(titles(groups[0].notes), ['Angeheftet alt']);
  });

  it('no pinned group without pinned notes', () => {
    const groups = groupNotes([note('A', '2026-10-27T09:00:00Z')], 'modified', now, tz);
    assert.deepEqual(kinds(groups), ['today']);
  });

  it('groups by the created date when sorted by it', () => {
    const n = note('Neu bearbeitet', '2026-10-27T09:00:00Z', { created: '2025-01-01T00:00:00Z' });
    assert.deepEqual(kinds(groupNotes([n], 'created', now, tz)), ['year']);
    assert.deepEqual(kinds(groupNotes([n], 'modified', now, tz)), ['today']);
  });

  it('keeps the order within a group', () => {
    const notes = sortNotes([note('B', '2026-10-27T08:00:00Z'), note('A', '2026-10-27T10:00:00Z')], 'modified');
    assert.deepEqual(titles(groupNotes(notes, 'modified', now, tz)[0].notes), ['A', 'B']);
  });
});
