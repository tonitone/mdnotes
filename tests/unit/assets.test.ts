import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attachmentExtension,
  attachmentMarkdown,
  attachmentNameFor,
  attachmentNameFromPath,
  assetNameFromPath,
  isAllowedAttachment,
  isAssetName,
  isImageAssetName,
  referencedAssets,
} from '../../src/shared/assets';

describe('attachments', () => {
  it('keeps the extension of ordinary files, in lower case', () => {
    assert.equal(attachmentExtension('Bericht.PDF'), 'pdf');
    assert.equal(attachmentExtension('daten.tar.gz'), 'gz');
    assert.equal(attachmentExtension('C:\\Users\\a\\Tabelle.xlsx'), 'xlsx');
    assert.equal(attachmentExtension('/home/a/notes.txt'), 'txt');
  });

  it('uses a neutral extension for files without one or with odd characters', () => {
    assert.equal(attachmentExtension('README'), 'dat');
    assert.equal(attachmentExtension('.hidden'), 'dat');
    assert.equal(attachmentExtension('datei.ä'), 'dat');
    assert.equal(attachmentExtension('datei.exe:stream'), 'dat');
  });

  it('refuses files that run code when opened', () => {
    for (const name of ['setup.exe', 'run.BAT', 'start.sh', 'tool.app', 'x.ps1', 'a.jar', 'b.desktop', 'c.appimage', 'd.lnk', 'e.appref-ms', 'f.py']) {
      assert.equal(isAllowedAttachment(name), false, name);
      assert.equal(attachmentExtension(name), null, name);
    }
    // Trailing dots and spaces do not hide the extension (Windows strips them).
    assert.equal(isAllowedAttachment('setup.exe.'), false);
    assert.equal(isAllowedAttachment('setup.exe  '), false);
  });

  it('names attachments by content and never with a blocked extension', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const name = await attachmentNameFor(bytes, 'Bericht.pdf');
    assert.match(name, /^[0-9a-f]{16}\.pdf$/);
    assert.equal(await attachmentNameFor(bytes, 'Kopie.PDF'), name);
    await assert.rejects(attachmentNameFor(bytes, 'setup.exe'));
    assert.equal(isAssetName(name), true);
    assert.equal(isAssetName('0123456789abcdef.exe'), false);
    assert.equal(isAssetName('0123456789abcdef.pdf/../x'), false);
  });

  it('tells images and attachments apart', () => {
    assert.equal(isImageAssetName('0123456789abcdef.png'), true);
    assert.equal(isImageAssetName('0123456789abcdef.pdf'), false);
    assert.equal(attachmentNameFromPath('assets/0123456789abcdef.pdf'), '0123456789abcdef.pdf');
    assert.equal(attachmentNameFromPath('./assets/0123456789abcdef.zip'), '0123456789abcdef.zip');
    assert.equal(attachmentNameFromPath('assets/0123456789abcdef.png'), null);
    assert.equal(attachmentNameFromPath('assets/0123456789abcdef.exe'), null);
    assert.equal(attachmentNameFromPath('https://example.com/a.pdf'), null);
    assert.equal(assetNameFromPath('assets/0123456789abcdef.pdf'), '0123456789abcdef.pdf');
  });

  it('writes a link with the file name as text, escaping brackets', () => {
    assert.equal(attachmentMarkdown('Bericht.pdf', 'assets/0123456789abcdef.pdf'), '[Bericht.pdf](assets/0123456789abcdef.pdf)');
    assert.equal(attachmentMarkdown('a [1].pdf', 'assets/x.pdf'), '[a \\[1\\].pdf](assets/x.pdf)');
    assert.equal(attachmentMarkdown('zwei\nZeilen.txt', 'assets/x.txt'), '[zwei Zeilen.txt](assets/x.txt)');
  });

  it('finds images and attachment links referenced by a note', () => {
    const body = [
      '# Notiz',
      '![Bild](assets/0123456789abcdef.png)',
      '[Bericht.pdf](assets/fedcba9876543210.pdf) und [Web](https://example.com)',
      '[Programm](assets/1111111111111111.exe)',
    ].join('\n');
    assert.deepEqual(referencedAssets(body), ['0123456789abcdef.png', 'fedcba9876543210.pdf']);
  });
});
