/** Messages between the app and the Mermaid iframe (`mermaid.html`). */

export interface DiagramRequest {
  id: number;
  source: string;
  theme: 'default' | 'dark';
}

export type DiagramReply = { ready: true } | { id: number; svg: string } | { id: number; error: string };
