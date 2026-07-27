import mermaid from 'mermaid';
import {
  beginViewportDrag,
  calculateSVGViewBox,
  createViewportState,
  endViewportDrag,
  moveViewportDrag,
  resetViewport,
  zoomViewport,
  type SVGViewBox,
} from '../src/viewport.js';

const viewport = requiredElement('viewport');
const diagram = requiredElement('diagram');
const error = requiredElement('error');
const sourceElement = requiredElement('mermaid-source');
const zoomInButton = requiredElement('zoom-in');
const zoomOutButton = requiredElement('zoom-out');
const resetButton = requiredElement('reset');

let viewportState = createViewportState();
let svgElement: SVGSVGElement | undefined;
let originalViewBox: SVGViewBox | undefined;

viewport.addEventListener('pointerdown', (event) => {
  const next = beginViewportDrag(viewportState, {
    button: event.button,
    pointerID: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (next === viewportState) {
    return;
  }

  viewportState = next;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
  event.preventDefault();
});

viewport.addEventListener('pointermove', (event) => {
  const next = moveViewportDrag(viewportState, {
    pointerID: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (next === viewportState) {
    return;
  }

  viewportState = next;
  applySVGViewport();
});

const finishDrag = (event: PointerEvent): void => {
  const next = endViewportDrag(viewportState, event.pointerId);
  if (next === viewportState) {
    return;
  }

  viewportState = next;
  if (viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
  viewport.classList.remove('dragging');
};

viewport.addEventListener('pointerup', finishDrag);
viewport.addEventListener('pointercancel', finishDrag);
viewport.addEventListener(
  'wheel',
  (event) => {
    viewportState = zoomViewport(
      viewportState,
      event.deltaY < 0 ? 1.1 : 1 / 1.1,
    );
    applySVGViewport();
    event.preventDefault();
  },
  { passive: false },
);

window.addEventListener('resize', () => {
  applySVGViewport();
});

zoomInButton.addEventListener('click', () => {
  viewportState = zoomViewport(viewportState, 1.2);
  applySVGViewport();
});

zoomOutButton.addEventListener('click', () => {
  viewportState = zoomViewport(viewportState, 1 / 1.2);
  applySVGViewport();
});

resetButton.addEventListener('click', () => {
  viewportState = resetViewport(viewportState);
  applySVGViewport();
});

void renderDiagram();

async function renderDiagram(): Promise<void> {
  try {
    const source = JSON.parse(sourceElement.textContent ?? '""') as unknown;
    if (typeof source !== 'string') {
      throw new Error('Mermaid source is not a string.');
    }

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.body.classList.contains('vscode-dark')
        ? 'dark'
        : 'default',
    });

    const rendered = await mermaid.render(
      `mermaid-tui-preview-${Date.now()}`,
      source,
    );
    diagram.innerHTML = rendered.svg;
    rendered.bindFunctions?.(diagram);
    svgElement = diagram.querySelector('svg') ?? undefined;
    if (!svgElement) {
      throw new Error('Mermaid did not render an SVG element.');
    }

    originalViewBox = readSVGViewBox(svgElement);
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    svgElement.style.width = '100%';
    svgElement.style.height = '100%';
    svgElement.style.maxWidth = 'none';
    svgElement.style.maxHeight = 'none';
    applySVGViewport();
  } catch (caught) {
    viewport.style.display = 'none';
    error.style.display = 'block';
    error.textContent =
      caught instanceof Error ? caught.message : String(caught);
  }
}

function applySVGViewport(): void {
  if (!svgElement || !originalViewBox) {
    return;
  }

  const bounds = viewport.getBoundingClientRect();
  const viewBox = calculateSVGViewBox(
    originalViewBox,
    viewportState,
    {
      width: bounds.width || originalViewBox.width,
      height: bounds.height || originalViewBox.height,
    },
  );
  svgElement.setAttribute(
    'viewBox',
    `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`,
  );
}

function readSVGViewBox(svg: SVGSVGElement): SVGViewBox {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width <= 0 || viewBox.height <= 0) {
    throw new Error('Mermaid rendered an invalid SVG viewBox.');
  }

  return {
    minX: viewBox.x,
    minY: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
  };
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing Mermaid preview element: ${id}`);
  }
  return element;
}
