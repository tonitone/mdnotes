import mermaid from 'mermaid';
import type { DiagramReply, DiagramRequest } from './editor/diagram-protocol';

/**
 * Runs inside the hidden iframe `mermaid.html`. Mermaid writes `style`
 * attributes and `<style>` elements into the live DOM while it measures text,
 * which the app's strict CSP forbids. This page has its own CSP that allows
 * inline styles (scripts stay limited to the app's own files), renders the
 * diagram here and sends the finished SVG back as a string. The app shows it
 * as an image, so its styles never touch the app's document.
 */

let initializedFor: string | null = null;
let counter = 0;

/** Gives the SVG a fixed size from its viewBox, so it works as an `<img>`. */
function sized(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const box = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    root.setAttribute('width', String(Math.ceil(box[2])));
    root.setAttribute('height', String(Math.ceil(box[3])));
    // Mermaid sets `max-width` here; the app limits the image width itself.
    root.removeAttribute('style');
  }
  return new XMLSerializer().serializeToString(root);
}

async function render(request: DiagramRequest): Promise<DiagramReply> {
  if (initializedFor !== request.theme) {
    mermaid.initialize({
      startOnLoad: false,
      // "strict" encodes HTML in labels and disables click handlers.
      securityLevel: 'strict',
      theme: request.theme,
      // A system font: an SVG shown as an image cannot load the app's fonts,
      // and text must be measured here with the font it is drawn in later.
      fontFamily: 'Arial, Helvetica, sans-serif',
      flowchart: { htmlLabels: false },
    });
    initializedFor = request.theme;
  }
  const id = `diagram-${++counter}`;
  try {
    const { svg } = await mermaid.render(id, request.source);
    return { id: request.id, svg: sized(svg) };
  } catch (error) {
    return { id: request.id, error: String(error) };
  } finally {
    // On errors Mermaid leaves its temporary container in the page.
    document.getElementById(`d${id}`)?.remove();
  }
}

window.addEventListener('message', (event: MessageEvent<DiagramRequest>) => {
  if (event.source !== window.parent) return;
  const request = event.data;
  if (typeof request?.id !== 'number' || typeof request.source !== 'string') return;
  if (request.theme !== 'default' && request.theme !== 'dark') return;
  void render(request).then((reply) => window.parent.postMessage(reply, '*'));
});

window.parent.postMessage({ ready: true } satisfies DiagramReply, '*');
