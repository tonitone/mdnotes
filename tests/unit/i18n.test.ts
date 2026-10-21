import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  CATALOGS,
  LOCALES,
  getLocale,
  isLanguageChoice,
  isRtl,
  resolveLocale,
  setLocale,
  t,
  textDirection,
  tp,
  type MessageKey,
} from '../../src/shared/i18n';
import { slugify, titleFromBody } from '../../src/shared/note';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  const keys = Object.keys(CATALOGS.de).sort();

  for (const locale of LOCALES) {
    it(`${locale} has exactly the German keys`, () => {
      assert.deepEqual(Object.keys(CATALOGS[locale]).sort(), keys);
    });

    it(`${locale} uses the same placeholders as German`, () => {
      for (const key of keys as MessageKey[]) {
        assert.deepEqual(placeholders(CATALOGS[locale][key]), placeholders(CATALOGS.de[key]), key);
      }
    });

    it(`${locale} has no empty messages`, () => {
      for (const key of keys as MessageKey[]) assert.ok(CATALOGS[locale][key].trim(), key);
    });
  }

  it('defines both plural forms for every plural key', () => {
    for (const key of keys) {
      if (key.endsWith('.one')) assert.ok(keys.includes(key.replace(/\.one$/, '.other')), key);
      if (key.endsWith('.other')) assert.ok(keys.includes(key.replace(/\.other$/, '.one')), key);
    }
  });
});

describe('t and tp', () => {
  afterEach(() => setLocale('de'));

  it('defaults to German', () => {
    assert.equal(getLocale(), 'de');
    assert.equal(t('notes.new'), 'Neue Notiz');
  });

  it('switches the locale', () => {
    setLocale('en');
    assert.equal(t('notes.new'), 'New note');
  });

  it('fills in placeholders and keeps unknown ones', () => {
    assert.equal(t('status.savedAt', { time: '10:05' }), 'Gespeichert um 10:05');
    assert.equal(t('status.savedAt'), 'Gespeichert um {time}');
  });

  it('picks plural forms', () => {
    assert.equal(tp('versions.lines', 1), '1 Zeile');
    assert.equal(tp('versions.lines', 0), '0 Zeilen');
    setLocale('en');
    assert.equal(tp('announce.labelRenamed', 2, { from: 'x' }), 'Label “x” renamed in 2 notes.');
  });

  it('localizes the untitled title and the slug fallback', () => {
    assert.equal(titleFromBody(''), 'Neue Notiz');
    assert.equal(slugify('!!!'), 'notiz');
    setLocale('en');
    assert.equal(titleFromBody(''), 'New note');
    assert.equal(slugify('!!!'), 'note');
  });
});

describe('resolveLocale', () => {
  it('uses an explicit choice', () => {
    assert.equal(resolveLocale('en', ['de-DE']), 'en');
  });

  it('follows the first supported preferred language', () => {
    assert.equal(resolveLocale('system', ['fr-FR', 'de-AT', 'en-US']), 'de');
    assert.equal(resolveLocale('system', ['en_GB']), 'en');
  });

  it('falls back to English', () => {
    assert.equal(resolveLocale('system', ['fr-FR']), 'en');
    assert.equal(resolveLocale('system', []), 'en');
  });

  it('validates choices', () => {
    assert.ok(isLanguageChoice('system'));
    assert.ok(isLanguageChoice('de'));
    assert.ok(!isLanguageChoice('fr'));
    assert.ok(!isLanguageChoice(undefined));
  });
});

describe('text direction', () => {
  it('detects right-to-left languages', () => {
    assert.ok(isRtl('ar'));
    assert.ok(isRtl('he-IL'));
    assert.ok(isRtl('fa_IR'));
    assert.ok(!isRtl('de'));
    assert.equal(textDirection('ur'), 'rtl');
    assert.equal(textDirection('en'), 'ltr');
  });
});
