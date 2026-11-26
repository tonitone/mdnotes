import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AssetPolicyError, assetFile, copyAssetFiles, listAssetFiles, readAssetFile, writeAssetFile } from '../../src/main/asset-policy';
import { collectWorkspace } from '../../src/main/backup';
import { NodeFs } from '../../src/main/node-fs';

const PDF = '0123456789abcdef.pdf';
const PNG = 'fedcba9876543210.png';
const bytes = (text: string) => new TextEncoder().encode(text);
// Symbolic links need extra rights on Windows.
const links = { skip: process.platform === 'win32' };

describe('asset policy', () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mdnotes-assets-'));
    workspace = path.join(root, 'ws');
    outside = path.join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores a file, reuses it for the same content and reads it back', async () => {
    assert.equal(await writeAssetFile(workspace, PDF, bytes('%PDF')), true);
    assert.equal(await writeAssetFile(workspace, PDF, bytes('%PDF')), false);
    assert.equal(await readFile(path.join(workspace, 'assets', PDF), 'utf8'), '%PDF');
    assert.deepEqual([...(await readAssetFile(workspace, PDF))], [...bytes('%PDF')]);
    assert.equal(await assetFile(workspace, 'aaaaaaaaaaaaaaaa.pdf'), null);
    // The workspace's NodeFs goes through the same rule.
    const fs = new NodeFs(workspace);
    assert.equal(await fs.writeAsset(PNG, bytes('png')), true);
    assert.equal(await fs.writeAsset(PNG, bytes('png')), false);
  });

  it('refuses invalid names', async () => {
    await assert.rejects(writeAssetFile(workspace, '../x.pdf', bytes('x')), AssetPolicyError);
    await assert.rejects(writeAssetFile(workspace, '0123456789abcdef.exe', bytes('x')), AssetPolicyError);
    await assert.rejects(assetFile(workspace, 'x/../0123456789abcdef.pdf'), AssetPolicyError);
  });

  it('refuses a linked assets folder for writing, reuse, reading and export', links, async () => {
    await writeFile(path.join(outside, PDF), '%PDF');
    await symlink(outside, path.join(workspace, 'assets'), 'dir');
    await assert.rejects(writeAssetFile(workspace, PDF, bytes('%PDF')), AssetPolicyError);
    await assert.rejects(writeAssetFile(workspace, PNG, bytes('new')), AssetPolicyError);
    await assert.rejects(assetFile(workspace, PDF), AssetPolicyError);
    await assert.rejects(readAssetFile(workspace, PDF), AssetPolicyError);
    // Nothing new was written through the link.
    assert.deepEqual(await readdir(outside), [PDF]);
    const target = path.join(root, 'export');
    assert.deepEqual(await copyAssetFiles(workspace, [PDF], target), []);
    assert.deepEqual(await readdir(path.join(target, 'assets')), []);
  });

  it('refuses a linked entry with an asset name, also as a deduplication hit', links, async () => {
    await writeFile(path.join(outside, 'secret.pdf'), 'secret');
    await mkdir(path.join(workspace, 'assets'));
    await symlink(path.join(outside, 'secret.pdf'), path.join(workspace, 'assets', PDF));
    // Same name would normally mean "already stored"; a link must not count as that.
    await assert.rejects(writeAssetFile(workspace, PDF, bytes('%PDF')), AssetPolicyError);
    await assert.rejects(assetFile(workspace, PDF), AssetPolicyError);
    await assert.rejects(readAssetFile(workspace, PDF), AssetPolicyError);
    assert.equal(await readFile(path.join(outside, 'secret.pdf'), 'utf8'), 'secret');
  });

  it('refuses a folder that carries an asset name', async () => {
    await mkdir(path.join(workspace, 'assets', PDF), { recursive: true });
    await assert.rejects(writeAssetFile(workspace, PDF, bytes('%PDF')), AssetPolicyError);
    await assert.rejects(assetFile(workspace, PDF), AssetPolicyError);
  });

  it('exports regular files and leaves out missing and refused ones', links, async () => {
    await writeAssetFile(workspace, PDF, bytes('%PDF'));
    await writeFile(path.join(outside, 'secret.png'), 'secret');
    await symlink(path.join(outside, 'secret.png'), path.join(workspace, 'assets', PNG));
    const target = path.join(root, 'export');
    const copied = await copyAssetFiles(workspace, [PDF, PNG, 'aaaaaaaaaaaaaaaa.zip'], target);
    assert.deepEqual(copied, [PDF]);
    assert.deepEqual(await readdir(path.join(target, 'assets')), [PDF]);
    // A second export into the same folder keeps the existing copy (same name, same content).
    assert.deepEqual(await copyAssetFiles(workspace, [PDF], target), []);
  });

  it('never writes an export through a linked destination assets folder', links, async () => {
    await writeAssetFile(workspace, PDF, bytes('%PDF'));
    const target = path.join(root, 'export');
    await mkdir(target);
    await symlink(outside, path.join(target, 'assets'), 'dir');
    await assert.rejects(copyAssetFiles(workspace, [PDF], target), AssetPolicyError);
    assert.deepEqual(await readdir(outside), []);
  });

  it('never replaces an existing entry in the export destination, not even a link', links, async () => {
    await writeAssetFile(workspace, PDF, bytes('%PDF'));
    await writeFile(path.join(outside, 'victim.pdf'), 'keep');
    const target = path.join(root, 'export');
    await mkdir(path.join(target, 'assets'), { recursive: true });
    await symlink(path.join(outside, 'victim.pdf'), path.join(target, 'assets', PDF));
    assert.deepEqual(await copyAssetFiles(workspace, [PDF], target), []);
    assert.equal(await readFile(path.join(outside, 'victim.pdf'), 'utf8'), 'keep');
  });

  it('backs up only assets the policy accepts', links, async () => {
    await writeFile(path.join(workspace, 'notiz.md'), '# Notiz\n');
    await writeAssetFile(workspace, PDF, bytes('%PDF'));
    await writeFile(path.join(outside, 'secret.png'), 'secret');
    await symlink(path.join(outside, 'secret.png'), path.join(workspace, 'assets', PNG));
    await mkdir(path.join(workspace, 'assets', 'aaaaaaaaaaaaaaaa.zip'));
    assert.deepEqual((await listAssetFiles(workspace)).map((a) => a.name), [PDF]);
    const paths = (await collectWorkspace(workspace, false)).map((e) => e.path);
    assert.deepEqual(paths.sort(), [`assets/${PDF}`, 'notiz.md']);
  });

  it('backs up no assets from a linked assets folder', links, async () => {
    await writeFile(path.join(workspace, 'notiz.md'), '# Notiz\n');
    await writeFile(path.join(outside, PDF), 'secret');
    await symlink(outside, path.join(workspace, 'assets'), 'dir');
    assert.deepEqual(await listAssetFiles(workspace), []);
    assert.deepEqual((await collectWorkspace(workspace, false)).map((e) => e.path), ['notiz.md']);
  });

  it('allows a workspace that is itself reached through a link', links, async () => {
    const linked = path.join(root, 'linked-ws');
    await symlink(workspace, linked, 'dir');
    assert.equal(await writeAssetFile(linked, PDF, bytes('%PDF')), true);
    assert.equal(await writeAssetFile(linked, PDF, bytes('%PDF')), false);
    assert.ok(await assetFile(linked, PDF));
  });
});
