import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ancestorsOf, buildFolderTree, findFolder, type FolderNode } from '../../src/shared/folder-tree';

/** A compact view of a tree: `name(count)[children]`. */
function shape(node: FolderNode): string {
  const children = node.children.map(shape).join(', ');
  return `${node.name || '/'}(${node.count})${children ? `[${children}]` : ''}`;
}

describe('buildFolderTree', () => {
  it('has only the root for a flat workspace', () => {
    const root = buildFolderTree(['a.md', 'b.md']);
    assert.equal(shape(root), '/(2)');
    assert.equal(root.path, '');
  });

  it('is empty for no notes', () => {
    assert.equal(shape(buildFolderTree([])), '/(0)');
  });

  it('nests folders and counts only the notes directly in each one', () => {
    const root = buildFolderTree(['root.md', 'projekte/a.md', 'projekte/2026/b.md', 'projekte/2026/c.md', 'archiv/alt.md']);
    assert.equal(shape(root), '/(1)[archiv(1), projekte(1)[2026(2)]]');
    assert.equal(findFolder(root, 'projekte/2026')?.path, 'projekte/2026');
  });

  it('creates intermediate folders that hold no notes themselves', () => {
    const root = buildFolderTree(['a/b/c/note.md']);
    assert.equal(shape(root), '/(0)[a(0)[b(0)[c(1)]]]');
    assert.deepEqual(
      [findFolder(root, 'a')?.path, findFolder(root, 'a/b')?.path, findFolder(root, 'a/b/c')?.path],
      ['a', 'a/b', 'a/b/c'],
    );
  });

  it('orders names numerically and ignores case and accents', () => {
    const root = buildFolderTree(['10/x.md', '2/x.md', 'beta/x.md', 'Alpha/x.md', 'Ärger/x.md'], 'de');
    assert.deepEqual(
      root.children.map((c) => c.name),
      ['2', '10', 'Alpha', 'Ärger', 'beta'],
    );
  });

  it('keeps folders that differ only in case apart, in a stable order', () => {
    const root = buildFolderTree(['notes/a.md', 'Notes/b.md'], 'en');
    assert.deepEqual(root.children.map((c) => c.path), ['Notes', 'notes']);
  });

  it('leaves out skipped folders and files that are not notes', () => {
    const root = buildFolderTree(['.git/x.md', 'assets/y.md', 'deep/node_modules/z.md', 'docs/readme.txt', 'docs/ok.md', '.hidden.md']);
    assert.equal(shape(root), '/(0)[docs(1)]');
  });
});

describe('findFolder', () => {
  const root = buildFolderTree(['a/b/x.md']);

  it('returns the root for an empty path', () => {
    assert.equal(findFolder(root, ''), root);
  });

  it('returns undefined for an unknown folder', () => {
    assert.equal(findFolder(root, 'a/c'), undefined);
    assert.equal(findFolder(root, 'z'), undefined);
  });
});

describe('ancestorsOf', () => {
  it('lists the folders above a path from the root down', () => {
    assert.deepEqual(ancestorsOf('a/b/c'), ['', 'a', 'a/b']);
    assert.deepEqual(ancestorsOf('a'), ['']);
    assert.deepEqual(ancestorsOf(''), []);
  });
});
