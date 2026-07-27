import { describe, expect, it } from 'vitest';
import {
  beginViewportDrag,
  calculateSVGViewBox,
  createViewportState,
  endViewportDrag,
  moveViewportDrag,
  resetViewport,
  zoomViewport,
} from '../src/viewport';

describe('Mermaid preview viewport drag', () => {
  it('moves the graph while the left mouse button is held', () => {
    const initial = createViewportState();
    const started = beginViewportDrag(initial, {
      button: 0,
      pointerID: 7,
      clientX: 100,
      clientY: 80,
    });
    const moved = moveViewportDrag(started, {
      pointerID: 7,
      clientX: 135,
      clientY: 110,
    });

    expect(moved).toMatchObject({
      x: 35,
      y: 30,
      dragging: {
        pointerID: 7,
        clientX: 135,
        clientY: 110,
      },
    });
  });

  it('ignores drag attempts from non-left mouse buttons', () => {
    const initial = createViewportState();

    expect(
      beginViewportDrag(initial, {
        button: 2,
        pointerID: 3,
        clientX: 20,
        clientY: 10,
      }),
    ).toEqual(initial);
  });

  it('stops moving after the active pointer is released', () => {
    const started = beginViewportDrag(createViewportState(), {
      button: 0,
      pointerID: 4,
      clientX: 10,
      clientY: 10,
    });
    const ended = endViewportDrag(started, 4);

    expect(
      moveViewportDrag(ended, {
        pointerID: 4,
        clientX: 40,
        clientY: 50,
      }),
    ).toEqual(ended);
  });

  it('keeps zoom within the supported range', () => {
    const initial = createViewportState();

    expect(zoomViewport(initial, 10).scale).toBe(4);
    expect(zoomViewport(initial, 0.01).scale).toBe(0.25);
  });

  it('resets pan and zoom to the initial view', () => {
    const transformed = {
      ...createViewportState(),
      x: 120,
      y: -40,
      scale: 2,
    };

    expect(resetViewport(transformed)).toEqual(createViewportState());
  });

  it('converts pan and zoom into a vector SVG viewBox', () => {
    const state = {
      ...createViewportState(),
      x: 20,
      y: 10,
      scale: 2,
    };

    expect(
      calculateSVGViewBox(
        { minX: 0, minY: 0, width: 200, height: 100 },
        state,
        { width: 200, height: 100 },
      ),
    ).toEqual({
      minX: 40,
      minY: 20,
      width: 100,
      height: 50,
    });
  });

  it('uses the uniform SVG scale when viewport aspect ratios differ', () => {
    const state = {
      ...createViewportState(),
      x: 100,
    };

    expect(
      calculateSVGViewBox(
        { minX: 0, minY: 0, width: 200, height: 400 },
        state,
        { width: 1000, height: 500 },
      ),
    ).toEqual({
      minX: -80,
      minY: 0,
      width: 200,
      height: 400,
    });
  });

});
