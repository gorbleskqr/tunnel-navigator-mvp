import { Edge, Graph, GraphLayout, GraphTopology, Size, Slot, WorldBounds } from '../types/types';

const DEFAULT_START_X = 220;
const DEFAULT_START_Y = 220;
const DEFAULT_SPACING_X = 240;
const DEFAULT_SPACING_Y = 150;
const DEFAULT_ROOT_NODE_ID = 'nicol_building';

export function buildSlotsFromGraph(graph: Graph, layout?: GraphLayout): Slot[] {
  const fallback = buildFallbackPositions(graph);
  const slotById = new Map((layout?.slots ?? []).map((slot) => [slot.id, slot]));

  return graph.nodes.map((node) => {
    const fallbackPosition = fallback.get(node.id) ?? { x: DEFAULT_START_X, y: DEFAULT_START_Y };
    const layoutSlot = slotById.get(node.id);
    const x = Number.isFinite(layoutSlot?.x) ? (layoutSlot?.x as number) : fallbackPosition.x;
    const y = Number.isFinite(layoutSlot?.y) ? (layoutSlot?.y as number) : fallbackPosition.y;

    return {
      id: node.id,
      x,
      y,
      node,
    };
  });
}

export function exportTopology(graph: Graph, edges: Edge[]): GraphTopology {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      type: edge.type,
    })),
  };
}

export function exportLayout(layout: GraphLayout, slots: Slot[], edges: Edge[], defaultCenterSlotId?: string): GraphLayout {
  const slotMap = new Map(slots.map((slot) => [slot.id, slot]));
  const sortedNodeIds = slots.map((slot) => slot.id).sort((a, b) => a.localeCompare(b));
  const edgeRenders = edges
    .filter((edge) => edge.render && hasNonDefaultRender(edge.render.mode, edge.render.bend, edge.render.waypoints))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      render: {
        mode: edge.render?.mode ?? 'straight',
        bend: edge.render?.bend,
        waypoints: edge.render?.waypoints,
      },
    }));

  return {
    slots: sortedNodeIds.map((id) => {
      const slot = slotMap.get(id);
      if (!slot) {
        return { id, x: DEFAULT_START_X, y: DEFAULT_START_Y };
      }

      return {
        id,
        x: round(slot.x),
        y: round(slot.y),
      };
    }),
    ...(edgeRenders.length > 0 ? { edgeRenders } : {}),
    view: {
      defaultCenterSlotId: defaultCenterSlotId ?? layout.view?.defaultCenterSlotId ?? DEFAULT_ROOT_NODE_ID,
    },
  };
}

export function getWorldBounds(slots: Slot[], padding = 90): WorldBounds {
  if (slots.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 1,
      height: 1,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const slot of slots) {
    minX = Math.min(minX, slot.x);
    maxX = Math.max(maxX, slot.x);
    minY = Math.min(minY, slot.y);
    maxY = Math.max(maxY, slot.y);
  }

  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
    maxY: maxY + padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

export function getZoomLimits(slots: Slot[], viewport: Size, bounds: WorldBounds): { minScale: number; maxScale: number } {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { minScale: 1, maxScale: 1 };
  }

  const fitScale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height);
  const minScale = clampScalar(fitScale, 0.2, 6);

  const nearestDistances = getNearestNeighborDistances(slots);
  const medianNearest = nearestDistances.length > 0 ? nearestDistances[Math.floor(nearestDistances.length / 2)] : 180;
  const minVisibleSpan = Math.max(190, medianNearest * 2.4);
  const constrainedMax = Math.min(viewport.width / minVisibleSpan, viewport.height / minVisibleSpan);
  const maxScale = Math.max(minScale, clampScalar(constrainedMax, minScale, 6));

  return { minScale, maxScale };
}

export function clampScalar(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildFallbackPositions(graph: Graph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (graph.nodes.length === 0) {
    return positions;
  }

  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const visited = new Set<string>();
  const rootCandidates: string[] = [];
  if (adjacency.has(DEFAULT_ROOT_NODE_ID)) {
    rootCandidates.push(DEFAULT_ROOT_NODE_ID);
  }
  for (const node of graph.nodes) {
    if (node.id !== DEFAULT_ROOT_NODE_ID) {
      rootCandidates.push(node.id);
    }
  }

  let componentOffsetX = DEFAULT_START_X;
  const baseY = DEFAULT_START_Y;

  for (const rootId of rootCandidates) {
    if (visited.has(rootId)) {
      continue;
    }

    const queue: string[] = [rootId];
    const depth = new Map<string, number>([[rootId, 0]]);
    visited.add(rootId);
    const layers = new Map<number, string[]>();

    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentDepth = depth.get(current) ?? 0;

      if (!layers.has(currentDepth)) {
        layers.set(currentDepth, []);
      }
      layers.get(currentDepth)?.push(current);

      const neighbors = (adjacency.get(current) ?? []).slice().sort((a, b) => a.localeCompare(b));
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }

        visited.add(neighbor);
        depth.set(neighbor, currentDepth + 1);
        queue.push(neighbor);
      }
    }

    const depthKeys = Array.from(layers.keys()).sort((a, b) => a - b);
    for (const d of depthKeys) {
      const layerIds = layers.get(d) ?? [];
      const centerIndex = (layerIds.length - 1) / 2;

      for (let i = 0; i < layerIds.length; i += 1) {
        const yOffset = (i - centerIndex) * DEFAULT_SPACING_Y;
        positions.set(layerIds[i], {
          x: componentOffsetX + d * DEFAULT_SPACING_X,
          y: baseY + yOffset,
        });
      }
    }

    const maxDepth = depthKeys.length > 0 ? depthKeys[depthKeys.length - 1] : 0;
    componentOffsetX += (maxDepth + 3) * DEFAULT_SPACING_X;
  }

  return positions;
}

function hasNonDefaultRender(
  mode: 'straight' | 'orthogonal',
  bend?: 'hv' | 'vh',
  waypoints?: Array<{ x: number; y: number }>,
): boolean {
  if (mode !== 'straight') {
    return true;
  }

  if (bend && bend !== 'hv') {
    return true;
  }

  return (waypoints?.length ?? 0) > 0;
}

function getNearestNeighborDistances(slots: Slot[]): number[] {
  if (slots.length < 2) {
    return [];
  }

  const nearest: number[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    let best = Number.POSITIVE_INFINITY;

    for (let j = 0; j < slots.length; j += 1) {
      if (i === j) {
        continue;
      }

      const dx = slots[i].x - slots[j].x;
      const dy = slots[i].y - slots[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d > 0 && d < best) {
        best = d;
      }
    }

    if (Number.isFinite(best)) {
      nearest.push(best);
    }
  }

  nearest.sort((a, b) => a - b);
  return nearest;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
