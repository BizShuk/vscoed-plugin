export interface ViewportDrag {
  pointerID: number;
  clientX: number;
  clientY: number;
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
  dragging: ViewportDrag | undefined;
}

export interface ViewportPointerDown {
  button: number;
  pointerID: number;
  clientX: number;
  clientY: number;
}

export interface ViewportPointerMove {
  pointerID: number;
  clientX: number;
  clientY: number;
}

export interface SVGViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function createViewportState(): ViewportState {
  return {
    x: 0,
    y: 0,
    scale: 1,
    dragging: undefined,
  };
}

export function beginViewportDrag(
  state: ViewportState,
  pointer: ViewportPointerDown,
): ViewportState {
  if (pointer.button !== 0 || state.dragging) {
    return state;
  }

  return {
    ...state,
    dragging: {
      pointerID: pointer.pointerID,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    },
  };
}

export function moveViewportDrag(
  state: ViewportState,
  pointer: ViewportPointerMove,
): ViewportState {
  if (!state.dragging || state.dragging.pointerID !== pointer.pointerID) {
    return state;
  }

  return {
    ...state,
    x: state.x + pointer.clientX - state.dragging.clientX,
    y: state.y + pointer.clientY - state.dragging.clientY,
    dragging: {
      pointerID: pointer.pointerID,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    },
  };
}

export function endViewportDrag(
  state: ViewportState,
  pointerID: number,
): ViewportState {
  if (state.dragging?.pointerID !== pointerID) {
    return state;
  }

  return {
    ...state,
    dragging: undefined,
  };
}

export function zoomViewport(
  state: ViewportState,
  factor: number,
): ViewportState {
  return {
    ...state,
    scale: Math.min(4, Math.max(0.25, state.scale * factor)),
  };
}

export function resetViewport(_state: ViewportState): ViewportState {
  return createViewportState();
}

export function calculateSVGViewBox(
  original: SVGViewBox,
  state: ViewportState,
  renderedSize: ViewportSize,
): SVGViewBox {
  const width = original.width / state.scale;
  const height = original.height / state.scale;
  const unitsPerPixel =
    Math.max(
      original.width / renderedSize.width,
      original.height / renderedSize.height,
    ) / state.scale;

  return {
    minX:
      original.minX +
      (original.width - width) / 2 -
      state.x * unitsPerPixel,
    minY:
      original.minY +
      (original.height - height) / 2 -
      state.y * unitsPerPixel,
    width,
    height,
  };
}
