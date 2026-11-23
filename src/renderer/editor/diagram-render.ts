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

/** The renderer itself could not start; the diagram code may be fine. */
export class DiagramUnavailableError extends Error {}

/** How long the frame may take to load Mermaid before diagrams show an error. */
const READY_TIMEOUT_MS = 20_000;

function loadFrame(): Promise<HTMLIFrameElement> {
  frame ??= new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'diagram-renderer';
    iframe.src = 'mermaid.html';
    iframe.tabIndex = -1;
    iframe.title = t('diagram.label');
    iframe.setAttribute('aria-hidden', 'true');
    const onMessage = (event: MessageEvent<DiagramReply>) => {
      if (event.source !== iframe.contentWindow) return;
      const reply = event.data;
      if ('ready' in reply) {
        window.clearTimeout(timer);
        resolve(iframe);
        return;
      }
      const job = pending.get(reply.id);
      if (!job) return;
      pending.delete(reply.id);
      if ('svg' in reply) job.resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(reply.svg)}`);
      else job.reject(new Error(reply.error));
    };
    // If the frame never reports ready (missing file, script error), fail instead
    // of leaving every diagram at "loading", and let the next diagram try again.
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      iframe.remove();
      frame = null;
      reject(new DiagramUnavailableError('Mermaid frame did not start'));
    }, READY_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    document.body.append(iframe);
  });
  return frame;
}

/** Returns the diagram as a `data:` URL with an SVG image. Rejects on invalid diagram code, or with
 * `DiagramUnavailableError` when the renderer could not start. */
export async function renderDiagram(source: string): Promise<string> {
  const iframe = await loadFrame();
  const id = ++nextId;
  const request: DiagramRequest = { id, source, theme: isDark() ? 'dark' : 'default' };
  return new Promise((resolve, reject) => {
    const target = iframe.contentWindow;
    if (!target) {
      reject(new DiagramUnavailableError('Mermaid frame is gone'));
      return;
    }
    pending.set(id, { resolve, reject });
    target.postMessage(request, '*');
  });
}
