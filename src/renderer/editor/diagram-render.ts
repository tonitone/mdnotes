import { adoptMarkup, type AdoptedMarkup } from './csp-dom';

/** Mermaid, loaded on first use (it is large). Returns SVG that satisfies the CSP. */
let counter = 0;
let initializedFor: string | null = null;

function isDark(): boolean {
  return /dark|hcb/.test(document.documentElement.dataset.theme ?? '');
}

export async function renderDiagram(source: string): Promise<AdoptedMarkup> {
  const { default: mermaid } = await import('mermaid');
  const theme = isDark() ? 'dark' : 'default';
  if (initializedFor !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // "strict" encodes HTML in labels and disables click handlers.
      securityLevel: 'strict',
      theme,
      fontFamily: '"72", Arial, sans-serif',
      flowchart: { htmlLabels: false },
    });
    initializedFor = theme;
  }
  const id = `mdnotes-diagram-${++counter}`;
  try {
    const { svg } = await mermaid.render(id, source);
    const adopted = adoptMarkup(svg, 'image/svg+xml');
    if (!adopted) throw new Error('Invalid SVG');
    return adopted;
  } finally {
    // On errors Mermaid leaves its temporary container in the page.
    document.getElementById(`d${id}`)?.remove();
  }
}
