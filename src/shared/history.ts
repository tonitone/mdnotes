import { sha256Hex } from './assets';
import type { FsPort } from './fs-port';

/**
 * Version history of notes, stored as plain files in `.history/<id>/`.
 *
 * A version file holds the note body (without front matter) and is named
 * `<epoch ms>-<first 8 hex chars of its SHA-256>.md`, so the list is sorted
 * by time and identical content is easy to detect.
 */

export const HISTORY_DIR = '.history';
export const VERSION_NAME_RE = /^(\d{13})-([0-9a-f]{8})\.md$/;

export interface VersionInfo {
  name: string;
  /** When the version was taken, milliseconds since the epoch. */
  time: number;
  hash: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function parseVersionName(name: string): VersionInfo | null {
  const m = VERSION_NAME_RE.exec(name);
  return m ? { name, time: Number(m[1]), hash: m[2] } : null;
}

export async function bodyHash(body: string): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(body))).slice(0, 8);
}

/**
 * Retention: everything from the last 24 hours, then the newest version per
 * day for 30 days, then the newest per week. The newest version is always kept.
 */
export function selectVersionsToKeep(times: number[], now: number): Set<number> {
  const keep = new Set<number>();
  const seenBuckets = new Set<string>();
  const sorted = [...times].sort((a, b) => b - a);
  sorted.forEach((time, index) => {
    const age = now - time;
    if (age < DAY) {
      keep.add(time);
      return;
    }
    const day = Math.floor(time / DAY);
    // Weeks start on Monday (1970-01-01 was a Thursday, hence the +3).
    const bucket = age < 30 * DAY ? `d${day}` : `w${Math.floor((day + 3) / 7)}`;
    // The newest version is always kept and also claims its day or week.
    if (index === 0 || !seenBuckets.has(bucket)) {
      seenBuckets.add(bucket);
      keep.add(time);
    }
  });
  return keep;
}

export class VersionStore {
  constructor(private readonly fs: FsPort) {}

  /** All versions of a note, newest first. */
  async list(id: string): Promise<VersionInfo[]> {
    return (await this.fs.listHistory(id))
      .map(parseVersionName)
      .filter((v): v is VersionInfo => v !== null)
      .sort((a, b) => b.time - a.time);
  }

  read(id: string, name: string): Promise<string> {
    return this.fs.readHistory(id, name);
  }

  /**
   * Stores `body` as a new version unless it equals the newest one.
   * Empty notes are not versioned. Returns the new version or `null`.
   */
  async snapshot(id: string, body: string, now: Date = new Date()): Promise<VersionInfo | null> {
    if (body.trim() === '') return null;
    const hash = await bodyHash(body);
    const versions = await this.list(id);
    if (versions[0]?.hash === hash) return null;
    // Never two versions in the same millisecond, keeps names unique and ordered.
    const time = Math.max(now.getTime(), (versions[0]?.time ?? 0) + 1);
    const name = `${time}-${hash}.md`;
    await this.fs.writeHistory(id, name, body);
    await this.prune(id, new Date(time), [{ name, time, hash }, ...versions]);
    return { name, time, hash };
  }

  /** Deletes versions the retention rules no longer need. Returns how many. */
  async prune(id: string, now: Date = new Date(), known?: VersionInfo[]): Promise<number> {
    const versions = known ?? (await this.list(id));
    const keep = selectVersionsToKeep(
      versions.map((v) => v.time),
      now.getTime(),
    );
    let removed = 0;
    for (const v of versions) {
      if (!keep.has(v.time)) {
        await this.fs.deleteHistory(id, v.name);
        removed++;
      }
    }
    return removed;
  }

  deleteAll(id: string): Promise<void> {
    return this.fs.deleteAllHistory(id);
  }
}
