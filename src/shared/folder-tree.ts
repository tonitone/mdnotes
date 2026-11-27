import { isNotePath } from './workspace-path';

/**
 * The folder tree of the library column, built from the notes' workspace
 * paths. Only folders that hold notes (directly or further down) appear, so
 * empty folders and skipped folders (`.git`, `assets`, …) never show up.
 */

export interface FolderNode {
  /** The last segment of the path (`''` for the workspace root). */
  name: string;
  /** Workspace-relative path with `/` (`''` for the root). */
  path: string;
  /** Notes directly in this folder, not counting subfolders. */
  count: number;
  /** Subfolders, ordered by name. */
  children: FolderNode[];
}

/**
 * Builds the tree for the given note file names. The result is the root node;
 * its children are the top-level folders. Names are ordered like note titles
 * (`Intl.Collator`, numeric, base sensitivity), so "2" comes before "10".
 */
export function buildFolderTree(fileNames: Iterable<string>, locale?: string): FolderNode {
  const root: FolderNode = { name: '', path: '', count: 0, children: [] };
  const byPath = new Map<string, FolderNode>([['', root]]);

  const folderNode = (path: string): FolderNode => {
    const known = byPath.get(path);
    if (known) return known;
    const at = path.lastIndexOf('/');
    const parent = folderNode(at === -1 ? '' : path.slice(0, at));
    const node: FolderNode = { name: path.slice(at + 1), path, count: 0, children: [] };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const fileName of fileNames) {
    if (!isNotePath(fileName)) continue;
    const at = fileName.lastIndexOf('/');
    folderNode(at === -1 ? '' : fileName.slice(0, at)).count++;
  }

  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const sort = (node: FolderNode) => {
    node.children.sort((a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** Finds the node for `path` in a tree built by `buildFolderTree`. */
export function findFolder(root: FolderNode, path: string): FolderNode | undefined {
  if (path === '') return root;
  let node: FolderNode | undefined = root;
  let prefix = '';
  for (const segment of path.split('/')) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    node = node.children.find((child) => child.path === prefix);
    if (!node) return undefined;
  }
  return node;
}

/** The paths of all folders above `path`, from the root down (`''` included, `path` itself not). */
export function ancestorsOf(path: string): string[] {
  if (path === '') return [];
  const paths = [''];
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i++) paths.push(segments.slice(0, i).join('/'));
  return paths;
}
