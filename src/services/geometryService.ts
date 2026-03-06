import { Size, Viewport, WorldBounds } from '../types/types';

export function clampViewport(viewport: Viewport, bounds: WorldBounds, size: Size): Viewport {
  if (size.width <= 0 || size.height <= 0) {
    return viewport;
  }

  const scaledWidth = bounds.width * viewport.scale;
  const scaledHeight = bounds.height * viewport.scale;
  // Allow a small amount of edge whitespace so panning feels less rigid.
  const edgeSlack = Math.max(14, Math.min(32, Math.min(size.width, size.height) * 0.045));

  let tx: number;
  let ty: number;

  if (scaledWidth <= size.width) {
    const centeredTx = size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * viewport.scale;
    tx = clamp(viewport.tx, centeredTx - edgeSlack, centeredTx + edgeSlack);
  } else {
    const minTx = size.width - bounds.maxX * viewport.scale - edgeSlack;
    const maxTx = -bounds.minX * viewport.scale + edgeSlack;
    tx = clamp(viewport.tx, minTx, maxTx);
  }

  if (scaledHeight <= size.height) {
    const centeredTy = size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * viewport.scale;
    ty = clamp(viewport.ty, centeredTy - edgeSlack, centeredTy + edgeSlack);
  } else {
    const minTy = size.height - bounds.maxY * viewport.scale - edgeSlack;
    const maxTy = -bounds.minY * viewport.scale + edgeSlack;
    ty = clamp(viewport.ty, minTy, maxTy);
  }

  return { ...viewport, tx, ty };
}

export function worldToScreenX(x: number, viewport: Viewport): number {
  return x * viewport.scale + viewport.tx;
}

export function worldToScreenY(y: number, viewport: Viewport): number {
  return y * viewport.scale + viewport.ty;
}

export function screenToWorldX(x: number, viewport: Viewport): number {
  return (x - viewport.tx) / viewport.scale;
}

export function screenToWorldY(y: number, viewport: Viewport): number {
  return (y - viewport.ty) / viewport.scale;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(aX: number, aY: number, bX: number, bY: number): number {
  const dx = aX - bX;
  const dy = aY - bY;
  return Math.sqrt(dx * dx + dy * dy);
}
