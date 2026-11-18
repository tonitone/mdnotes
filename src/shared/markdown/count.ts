/** Word and character counts of a note body. */
export interface TextCount {
  words: number;
  /** Characters (Unicode code points) without line breaks. */
  chars: number;
}

/**
 * Counts the words and characters of a Markdown body.
 * A word is a run of non-space characters that contains a letter or a digit,
 * so list markers, heading hashes and table pipes do not count.
 */
export function countText(body: string): TextCount {
  let words = 0;
  for (const token of body.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words++;
  }
  let chars = 0;
  for (const ch of body) {
    if (ch !== '\n' && ch !== '\r') chars++;
  }
  return { words, chars };
}
