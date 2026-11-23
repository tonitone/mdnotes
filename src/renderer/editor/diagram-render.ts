import { t } from '../../shared/i18n';
import type { DiagramReply, DiagramRequest } from './diagram-protocol';

/**
 * Renders Mermaid diagrams in a hidden iframe (see `mermaid-frame.ts`) and
 * returns them as `data:` URLs for an `<img>`. The iframe is created on
 * first use, so Mermaid (large) is only loaded when a note has a diagram.
 */

let frame: Promise<HTMLIFrameElement> | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (url: string) => void; reject: (error: Error) => void }>();

function isDark(): boolean {
  return /dark|hcb/.test(document.documentElement.dataset.theme ?? '');
}

function loadFrame(): Promise<HTMLIFrameElement> {
  frame ??= new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'diagram-renderer';
    iframe.src = 'mermaid.html';
    iframe.tabIndex = -1;
    iframe.title = t('diagram.label');
    iframe.setAttribute('aria-hidden', 'true');
    window.addEventListener('message', (event: MessageEvent<DiagramReply>) => {
      if (event.source !== iframe.contentWindow) return;
      const reply = event.data;
      if ('ready' in reply) {
        resolve(iframe);
        return;
      }
      const job = pending.get(reply.id);
      if (!job) return;
      pending.delete(reply.id);
      if ('svg' in reply) job.resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(reply.svg)}`);
      else job.reject(new Error(reply.error));
    });
    document.body.append(iframe);
  });
  return frame;
}

/** Returns the diagram as a `data:` URL with an SVG image. Rejects on invalid diagram code. */
export async function renderDiagram(source: string): Promise<string> {
  const iframe = await loadFrame();
  const id = ++nextId;
  const request: DiagramRequest = { id, source, theme: isDark() ? 'dark' : 'default' };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    iframe.contentWindow?.postMessage(request, '*');
  });
}
