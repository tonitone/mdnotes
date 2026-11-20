import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanLinkTitle, findWikiLinks, formatWikiLink, linksTo, wikiLinksToText } from '../../src/shared/wikilinks';
import { markdownToHtml } from '../../src/shared/markdown/html';

const A = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const B = '01JZZZZZZZZZZZZZZZZZZZZZZZ';

describe('wikilinks', () => {
  it('formats and finds links', () => {
    const text = `See ${formatWikiLink(A, 'Plan')} and ${formatWikiLink(B, 'Ideas')}.`;
    const links = findWikiLinks(text);
    assert.deepEqual(links.map((l) => [l.id, l.alias]), [
      [A, 'Plan'],
      [B, 'Ideas'],
    ]);
    assert.equal(text.slice(links[0].from, links[0].to), `[[${A}|Plan]]`);
  });

  it('keeps titles safe inside a link', () => {
    assert.equal(cleanLinkTitle('a [b] | c\nd'), 'a b c d');
    assert.equal(formatWikiLink(A, '[x]'), `[[${A}|x]]`);
  });

  it('ignores text that is not a link to an ID', () => {
    assert.deepEqual(findWikiLinks('[[Plan]] [[abc|Plan]] [[ ]]'), []);
  });

  it('knows whether a body links to a note', () => {
    assert.equal(linksTo(`x [[${A}|Plan]]`, A), true);
    assert.equal(linksTo(`x [[${A}|Plan]]`, B), false);
    assert.equal(linksTo(`x ${A}`, A), false);
  });

  it('turns links into the current title, or the written one', () => {
    const text = `[[${A}|Old]] [[${B}|Gone]]`;
    assert.equal(wikiLinksToText(text, (id) => (id === A ? 'New' : undefined)), 'New Gone');
    assert.equal(wikiLinksToText('no links'), 'no links');
  });

  it('renders as title in HTML exports', () => {
    assert.ok(markdownToHtml(`Siehe [[${A}|Plan]]`).includes('Siehe Plan'));
  });
});
