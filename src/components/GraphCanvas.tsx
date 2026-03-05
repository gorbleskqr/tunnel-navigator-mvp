
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { buildAdjacencyList, graph } from '../engine/graph';
import {
  clamp,
  clampViewport,
  distance,
  screenToWorldX,
  screenToWorldY,
} from '../services/geometryService';
import {
  buildSlotsFromGraph,
  clampScalar,
  exportGraphWithSlotPositions,
  getWorldBounds,
  getZoomLimits,
} from '../services/layoutService';
import { getRoutes } from '../services/routeService';
import { Edge, EdgeBendMode, Endpoint, Route, Size, Slot, Viewport } from '../types/types';

const SLOT_RADIUS = 18;
const ENDPOINT_RADIUS = 24;
const TAP_RADIUS_PX = 26;
const DRAG_RADIUS_PX = 28;
const SNAP_RADIUS_PX = 36;
const TAP_MOVE_THRESHOLD = 8;
const DELETE_ZONE_HEIGHT = 104;
const DEFAULT_CENTER_SLOT_ID = 'nicol_building';
const GRID_SIZE_OPTIONS = [40, 80, 120] as const;

const NODE_TYPE_COLORS: Record<string, string> = {
  building: '#3f96ff',
  junction: '#20b36f',
  intersection: '#f2a33a',
  stairs: '#db5b5b',
  exterior: '#706cff',
};

const EDGE_TYPE_COLORS: Record<string, string> = {
  flat: '#4a627f',
  ramp: '#f2a33a',
  stairs: '#db5b5b',
};

type InteractionState =
  | { kind: 'idle' }
  | {
    kind: 'pan';
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
    moved: boolean;
    slotTapCandidateId: string | null;
    edgeTapCandidateIndex: number | null;
  }
  | {
    kind: 'slot-drag';
    slotId: string;
  }
  | {
    kind: 'endpoint-drag';
    endpointId: Endpoint['id'];
    originSlotId: string;
  }
  | {
    kind: 'pinch';
    startDistance: number;
    startScale: number;
    anchorWorldX: number;
    anchorWorldY: number;
  };

interface TouchPoint {
  x: number;
  y: number;
  id: number;
}

interface DraggingEndpointState {
  endpointId: Endpoint['id'];
  worldX: number;
  worldY: number;
  overDeleteZone: boolean;
  targetSlotId: string | null;
}

interface EdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function getEdgeBendMode(edge: Edge): EdgeBendMode {
  return edge.render?.bend === 'vh' ? 'vh' : 'hv';
}

function getEdgeSegments(edge: Edge, slotById: Map<string, Slot>): EdgeSegment[] {
  const from = slotById.get(edge.from);
  const to = slotById.get(edge.to);

  if (!from || !to) {
    return [];
  }

  const mode = edge.render?.mode ?? 'straight';
  const waypoints = edge.render?.waypoints ?? [];

  if (mode === 'straight') {
    return [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }];
  }

  const points: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  if (waypoints.length > 0) {
    points.push(...waypoints);
  } else {
    const bend = getEdgeBendMode(edge);
    points.push(
      bend === 'vh'
        ? { x: from.x, y: to.y }
        : { x: to.x, y: from.y },
    );
  }
  points.push({ x: to.x, y: to.y });

  const segments: EdgeSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y === b.y) {
      continue;
    }

    segments.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }

  return segments;
}

function distanceToSegment(
  pointX: number,
  pointY: number,
  segment: EdgeSegment,
): number {
  const ax = segment.x1;
  const ay = segment.y1;
  const bx = segment.x2;
  const by = segment.y2;
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;

  if (lengthSq <= 0.000001) {
    return distance(pointX, pointY, ax, ay);
  }

  const t = clamp(((pointX - ax) * abx + (pointY - ay) * aby) / lengthSq, 0, 1);
  const projX = ax + t * abx;
  const projY = ay + t * aby;
  return distance(pointX, pointY, projX, projY);
}

function midpoint(a: TouchPoint, b: TouchPoint): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distanceBetweenTouches(a: TouchPoint, b: TouchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function endpointOrder(endpoints: Endpoint[]): Endpoint[] {
  if (endpoints.length === 0) {
    return [];
  }

  if (endpoints.length === 1) {
    return [{ id: 'start', slotId: endpoints[0].slotId }];
  }

  const start = endpoints.find((endpoint) => endpoint.id === 'start') ?? endpoints[0];
  const end = endpoints.find((endpoint) => endpoint.id === 'end')
    ?? endpoints.find((endpoint) => endpoint.slotId !== start.slotId)
    ?? endpoints[1];

  return [
    { id: 'start', slotId: start.slotId },
    { id: 'end', slotId: end.slotId },
  ];
}

export default function GraphCanvas() {
  const [slots, setSlots] = useState<Slot[]>(() => buildSlotsFromGraph(graph));
  const [edges, setEdges] = useState<Edge[]>(() => graph.edges.map((edge) => ({ ...edge })));
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [edgeEditorIndex, setEdgeEditorIndex] = useState<number | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] = useState<DraggingEndpointState | null>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const [gridSizeIndex, setGridSizeIndex] = useState(1);

  const initializedRef = useRef(false);
  const interactionRef = useRef<InteractionState>({ kind: 'idle' });
  const blockedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slotsRef = useRef(slots);
  const endpointsRef = useRef(endpoints);
  const viewportRef = useRef(viewport);
  const viewportSizeRef = useRef(viewportSize);
  const draggingEndpointRef = useRef<DraggingEndpointState | null>(draggingEndpoint);
  const editLayoutRef = useRef(editLayoutMode);

  const shakeX = useRef(new Animated.Value(0)).current;
  const canvasRef = useRef<View | null>(null);

  slotsRef.current = slots;
  endpointsRef.current = endpoints;
  viewportRef.current = viewport;
  viewportSizeRef.current = viewportSize;
  draggingEndpointRef.current = draggingEndpoint;
  editLayoutRef.current = editLayoutMode;

  const getLocalPoint = (
    clientX?: number,
    clientY?: number,
    fallbackX?: number,
    fallbackY?: number,
  ): { x: number; y: number } => {
    if (Platform.OS === 'web') {
      const element = canvasRef.current as unknown as { getBoundingClientRect?: () => DOMRect };
      const rect = element?.getBoundingClientRect?.();
      if (
        rect
        && Number.isFinite(clientX)
        && Number.isFinite(clientY)
      ) {
        return {
          x: (clientX as number) - rect.left,
          y: (clientY as number) - rect.top,
        };
      }
    }

    return {
      x: fallbackX ?? 0,
      y: fallbackY ?? 0,
    };
  };

  const getInteractionPoints = (event: GestureResponderEvent): TouchPoint[] => {
    const nativeEvent = event.nativeEvent as unknown as {
      touches?: Array<{
        identifier?: number;
        locationX?: number;
        locationY?: number;
        pageX?: number;
        pageY?: number;
        clientX?: number;
        clientY?: number;
      }>;
      locationX?: number;
      locationY?: number;
      pageX?: number;
      pageY?: number;
      clientX?: number;
      clientY?: number;
      identifier?: number;
    };

    if (nativeEvent.touches && nativeEvent.touches.length > 0) {
      return nativeEvent.touches.map((touch, index) => {
        const point = getLocalPoint(
          touch.clientX,
          touch.clientY,
          touch.locationX ?? touch.pageX,
          touch.locationY ?? touch.pageY,
        );

        return {
          x: point.x,
          y: point.y,
          id: touch.identifier ?? index,
        };
      });
    }

    const point = getLocalPoint(
      nativeEvent.clientX,
      nativeEvent.clientY,
      nativeEvent.locationX ?? nativeEvent.pageX,
      nativeEvent.locationY ?? nativeEvent.pageY,
    );

    return [{
      x: point.x,
      y: point.y,
      id: nativeEvent.identifier ?? 0,
    }];
  };

  const bounds = useMemo(() => getWorldBounds(slots), [slots]);
  const zoomLimits = useMemo(() => getZoomLimits(slots, viewportSize, bounds), [slots, viewportSize, bounds]);
  const gridSize = GRID_SIZE_OPTIONS[gridSizeIndex] ?? GRID_SIZE_OPTIONS[1];
  const gridMargin = gridSize * 2;

  const slotById = useMemo(() => {
    return new Map(slots.map((slot) => [slot.id, slot]));
  }, [slots]);

  const adjacency = useMemo(() => {
    return buildAdjacencyList({
      nodes: graph.nodes,
      edges,
    });
  }, [edges]);

  const routes = useMemo<Route[]>(() => {
    if (endpoints.length !== 2) {
      return [];
    }

    const ordered = endpointOrder(endpoints);
    if (ordered.length !== 2) {
      return [];
    }

    return getRoutes(ordered[0].slotId, ordered[1].slotId, adjacency);
  }, [adjacency, endpoints]);

  const highlightedEdgeKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const route of routes) {
      for (let index = 0; index < route.path.length - 1; index += 1) {
        keys.add(edgeKey(route.path[index], route.path[index + 1]));
      }
    }

    return keys;
  }, [routes]);

  const highlightedSlotIds = useMemo(() => {
    const ids = new Set<string>();

    for (const route of routes) {
      for (const slotId of route.path) {
        ids.add(slotId);
      }
    }

    return ids;
  }, [routes]);

  const exportJson = useMemo(() => {
    const withPositions = exportGraphWithSlotPositions({
      nodes: graph.nodes,
      edges,
    }, slots);
    return JSON.stringify(withPositions, null, 2);
  }, [edges, slots]);

  const worldSize = useMemo(() => {
    return {
      width: Math.max(1, bounds.maxX + 140),
      height: Math.max(1, bounds.maxY + 140),
    };
  }, [bounds]);

  const gridModel = useMemo(() => {
    if (!editLayoutMode) {
      return {
        xValues: [] as number[],
        yValues: [] as number[],
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
      };
    }

    const startX = Math.floor((bounds.minX - gridMargin) / gridSize) * gridSize;
    const endX = Math.ceil((bounds.maxX + gridMargin) / gridSize) * gridSize;
    const startY = Math.floor((bounds.minY - gridMargin) / gridSize) * gridSize;
    const endY = Math.ceil((bounds.maxY + gridMargin) / gridSize) * gridSize;

    const xValues: number[] = [];
    const yValues: number[] = [];

    for (let x = startX; x <= endX; x += gridSize) {
      xValues.push(x);
    }

    for (let y = startY; y <= endY; y += gridSize) {
      yValues.push(y);
    }

    return {
      xValues,
      yValues,
      minX: xValues[0] ?? 0,
      maxX: xValues[xValues.length - 1] ?? 0,
      minY: yValues[0] ?? 0,
      maxY: yValues[yValues.length - 1] ?? 0,
    };
  }, [bounds, editLayoutMode, gridMargin, gridSize]);

  const setViewportClamped = (next: Viewport): void => {
    const clampedScale = clampScalar(next.scale, zoomLimits.minScale, zoomLimits.maxScale);
    const clampedViewport = clampViewport({ ...next, scale: clampedScale }, bounds, viewportSizeRef.current);
    setViewport(clampedViewport);
  };

  const centerOnSlot = (slotId: string, scale?: number): void => {
    const targetSlot = slotById.get(slotId);
    if (!targetSlot) {
      return;
    }

    const activeScale = scale ?? viewportRef.current.scale;
    const unclamped: Viewport = {
      scale: activeScale,
      tx: viewportSizeRef.current.width / 2 - targetSlot.x * activeScale,
      ty: viewportSizeRef.current.height / 2 - targetSlot.y * activeScale,
    };

    setViewportClamped(unclamped);
  };

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || slots.length === 0 || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    const startScale = clampScalar(zoomLimits.minScale * 1.35, zoomLimits.minScale, zoomLimits.maxScale);
    setViewport(() => {
      const slot = slotById.get(DEFAULT_CENTER_SLOT_ID) ?? slots[0];
      const centered: Viewport = {
        scale: startScale,
        tx: viewportSize.width / 2 - slot.x * startScale,
        ty: viewportSize.height / 2 - slot.y * startScale,
      };
      return clampViewport(centered, bounds, viewportSize);
    });
  }, [bounds, slots, slotById, viewportSize, zoomLimits.maxScale, zoomLimits.minScale]);

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    setViewport((previous) => {
      const scale = clampScalar(previous.scale, zoomLimits.minScale, zoomLimits.maxScale);
      const clamped = clampViewport({ ...previous, scale }, bounds, viewportSize);

      if (
        approxEqual(previous.scale, clamped.scale)
        && approxEqual(previous.tx, clamped.tx)
        && approxEqual(previous.ty, clamped.ty)
      ) {
        return previous;
      }

      return clamped;
    });
  }, [bounds, viewportSize, zoomLimits.maxScale, zoomLimits.minScale]);

  useEffect(() => {
    if (!editLayoutMode) {
      setEdgeEditorIndex(null);
      return;
    }

    setEndpoints([]);
    setDraggingEndpoint(null);
  }, [editLayoutMode]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const element = canvasRef.current as unknown as {
      addEventListener?: (type: string, listener: (event: WheelEvent) => void, options?: AddEventListenerOptions) => void;
      removeEventListener?: (type: string, listener: (event: WheelEvent) => void) => void;
      getBoundingClientRect?: () => DOMRect;
    };
    if (!element?.addEventListener || !element?.removeEventListener || !element?.getBoundingClientRect) {
      return;
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = element.getBoundingClientRect?.();
      if (!rect) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const previous = viewportRef.current;
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      const nextScale = clampScalar(previous.scale * factor, zoomLimits.minScale, zoomLimits.maxScale);
      const anchorWorldX = screenToWorldX(x, previous);
      const anchorWorldY = screenToWorldY(y, previous);

      setViewportClamped({
        scale: nextScale,
        tx: x - anchorWorldX * nextScale,
        ty: y - anchorWorldY * nextScale,
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener?.('wheel', onWheel);
    };
  }, [zoomLimits.maxScale, zoomLimits.minScale]);

  useEffect(() => {
    return () => {
      if (blockedTimerRef.current) {
        clearTimeout(blockedTimerRef.current);
      }
    };
  }, []);

  const triggerBlockedFeedback = (message: string): void => {
    setBlockedMessage(message);

    if (blockedTimerRef.current) {
      clearTimeout(blockedTimerRef.current);
    }

    blockedTimerRef.current = setTimeout(() => {
      setBlockedMessage(null);
      blockedTimerRef.current = null;
    }, 1200);

    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -10, duration: 35, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  };

  const getSlotAtWorldPosition = (
    worldX: number,
    worldY: number,
    radiusWorld: number,
  ): { slot: Slot; distance: number } | null => {
    let bestSlot: Slot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const slot of slotsRef.current) {
      const d = distance(worldX, worldY, slot.x, slot.y);
      if (d <= radiusWorld && d < bestDistance) {
        bestSlot = slot;
        bestDistance = d;
      }
    }

    if (!bestSlot) {
      return null;
    }

    return { slot: bestSlot, distance: bestDistance };
  };

  const getEndpointWorldPosition = (endpointId: Endpoint['id']): { x: number; y: number } | null => {
    const drag = draggingEndpointRef.current;
    if (drag && drag.endpointId === endpointId) {
      return { x: drag.worldX, y: drag.worldY };
    }

    const endpoint = endpointsRef.current.find((item) => item.id === endpointId);
    if (!endpoint) {
      return null;
    }

    const slot = slotById.get(endpoint.slotId);
    if (!slot) {
      return null;
    }

    return { x: slot.x, y: slot.y };
  };

  const getEndpointAtWorldPosition = (
    worldX: number,
    worldY: number,
    radiusWorld: number,
  ): Endpoint | null => {
    for (const endpoint of endpointsRef.current) {
      const position = getEndpointWorldPosition(endpoint.id);
      if (!position) {
        continue;
      }

      const d = distance(worldX, worldY, position.x, position.y);
      if (d <= radiusWorld) {
        return endpoint;
      }
    }

    return null;
  };

  const getEdgeHitAtWorldPosition = (
    worldX: number,
    worldY: number,
    radiusWorld: number,
  ): number | null => {
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      const segments = getEdgeSegments(edge, slotById);

      for (const segment of segments) {
        const d = distanceToSegment(worldX, worldY, segment);
        if (d <= radiusWorld && d < bestDistance) {
          bestDistance = d;
          bestIndex = edgeIndex;
        }
      }
    }

    return bestIndex;
  };

  const handleSlotTap = (slotId: string): void => {
    if (editLayoutRef.current) {
      return;
    }

    const occupied = endpointsRef.current.some((endpoint) => endpoint.slotId === slotId);
    if (occupied) {
      return;
    }

    if (endpointsRef.current.length === 0) {
      setEndpoints([{ id: 'start', slotId }]);
      return;
    }

    if (endpointsRef.current.length === 1) {
      const existing = endpointsRef.current[0];
      setEndpoints(endpointOrder([
        { id: existing.id === 'end' ? 'end' : 'start', slotId: existing.slotId },
        { id: existing.id === 'start' ? 'end' : 'start', slotId },
      ]));
      return;
    }

    triggerBlockedFeedback('Two endpoints already exist. Drag one instead.');
  };

  const finalizeEndpointDrop = (): void => {
    const drag = draggingEndpointRef.current;
    if (!drag) {
      return;
    }

    if (drag.overDeleteZone) {
      setEndpoints((previous) => previous.filter((endpoint) => endpoint.id !== drag.endpointId));
      setDraggingEndpoint(null);
      draggingEndpointRef.current = null;
      return;
    }

    const targetSlotId = drag.targetSlotId;

    if (!targetSlotId) {
      setDraggingEndpoint(null);
      draggingEndpointRef.current = null;
      return;
    }

    setEndpoints((previous) => {
      const dragIndex = previous.findIndex((endpoint) => endpoint.id === drag.endpointId);
      if (dragIndex < 0) {
        return previous;
      }

      const targetOccupantIndex = previous.findIndex((endpoint) => endpoint.slotId === targetSlotId);
      const next = [...previous];

      if (targetOccupantIndex >= 0 && targetOccupantIndex !== dragIndex) {
        const currentSlotId = next[dragIndex].slotId;
        next[dragIndex] = { ...next[dragIndex], slotId: next[targetOccupantIndex].slotId };
        next[targetOccupantIndex] = { ...next[targetOccupantIndex], slotId: currentSlotId };
      } else {
        next[dragIndex] = { ...next[dragIndex], slotId: targetSlotId };
      }

      return endpointOrder(next);
    });

    setDraggingEndpoint(null);
    draggingEndpointRef.current = null;
  };

  const startPinch = (first: TouchPoint, second: TouchPoint): void => {
    const startDistance = Math.max(1, distanceBetweenTouches(first, second));
    const mid = midpoint(first, second);
    const currentViewport = viewportRef.current;

    interactionRef.current = {
      kind: 'pinch',
      startDistance,
      startScale: currentViewport.scale,
      anchorWorldX: screenToWorldX(mid.x, currentViewport),
      anchorWorldY: screenToWorldY(mid.y, currentViewport),
    };
  };

  const onResponderGrant = (event: GestureResponderEvent): void => {
    const touches = getInteractionPoints(event);

    if (touches.length >= 2) {
      startPinch(touches[0], touches[1]);
      return;
    }

    const touch = touches[0];
    const currentViewport = viewportRef.current;
    const worldX = screenToWorldX(touch.x, currentViewport);
    const worldY = screenToWorldY(touch.y, currentViewport);
    const dragRadiusWorld = DRAG_RADIUS_PX / currentViewport.scale;

    const endpoint = getEndpointAtWorldPosition(worldX, worldY, dragRadiusWorld);
    if (endpoint && !editLayoutRef.current) {
      const slot = slotById.get(endpoint.slotId);
      if (slot) {
        const nextDrag: DraggingEndpointState = {
          endpointId: endpoint.id,
          worldX: slot.x,
          worldY: slot.y,
          overDeleteZone: false,
          targetSlotId: null,
        };
        setDraggingEndpoint(nextDrag);
        draggingEndpointRef.current = nextDrag;

        interactionRef.current = {
          kind: 'endpoint-drag',
          endpointId: endpoint.id,
          originSlotId: endpoint.slotId,
        };
        return;
      }
    }

    if (editLayoutRef.current) {
      const slotHit = getSlotAtWorldPosition(worldX, worldY, dragRadiusWorld);
      if (slotHit) {
        interactionRef.current = {
          kind: 'slot-drag',
          slotId: slotHit.slot.id,
        };
        return;
      }
    }

    const edgeHitIndex = editLayoutRef.current
      ? getEdgeHitAtWorldPosition(worldX, worldY, TAP_RADIUS_PX / currentViewport.scale)
      : null;
    const tapHit = getSlotAtWorldPosition(worldX, worldY, TAP_RADIUS_PX / currentViewport.scale);
    interactionRef.current = {
      kind: 'pan',
      startX: touch.x,
      startY: touch.y,
      startTx: currentViewport.tx,
      startTy: currentViewport.ty,
      moved: false,
      slotTapCandidateId: tapHit?.slot.id ?? null,
      edgeTapCandidateIndex: edgeHitIndex,
    };
  };

  const onResponderMove = (event: GestureResponderEvent): void => {
    const touches = getInteractionPoints(event);
    const currentInteraction = interactionRef.current;

    if (touches.length >= 2) {
      if (currentInteraction.kind !== 'pinch') {
        startPinch(touches[0], touches[1]);
      }

      const pinch = interactionRef.current;
      if (pinch.kind !== 'pinch') {
        return;
      }

      const currentDistance = Math.max(1, distanceBetweenTouches(touches[0], touches[1]));
      const zoomRatio = currentDistance / pinch.startDistance;
      const scale = clampScalar(pinch.startScale * zoomRatio, zoomLimits.minScale, zoomLimits.maxScale);
      const mid = midpoint(touches[0], touches[1]);

      setViewportClamped({
        scale,
        tx: mid.x - pinch.anchorWorldX * scale,
        ty: mid.y - pinch.anchorWorldY * scale,
      });
      return;
    }

    const touch = touches[0];

    if (currentInteraction.kind === 'endpoint-drag') {
      const currentViewport = viewportRef.current;
      const worldX = screenToWorldX(touch.x, currentViewport);
      const worldY = screenToWorldY(touch.y, currentViewport);
      const snapRadiusWorld = SNAP_RADIUS_PX / currentViewport.scale;
      const slotHit = getSlotAtWorldPosition(worldX, worldY, snapRadiusWorld);

      const nextDrag: DraggingEndpointState = {
        endpointId: currentInteraction.endpointId,
        worldX,
        worldY,
        overDeleteZone: touch.y >= viewportSizeRef.current.height - DELETE_ZONE_HEIGHT,
        targetSlotId: slotHit?.slot.id ?? null,
      };

      setDraggingEndpoint(nextDrag);
      draggingEndpointRef.current = nextDrag;
      return;
    }

    if (currentInteraction.kind === 'slot-drag') {
      const currentViewport = viewportRef.current;
      const worldX = screenToWorldX(touch.x, currentViewport);
      const worldY = screenToWorldY(touch.y, currentViewport);
      const snappedX = Math.round(worldX / gridSize) * gridSize;
      const snappedY = Math.round(worldY / gridSize) * gridSize;

      setSlots((previous) => previous.map((slot) => {
        if (slot.id !== currentInteraction.slotId) {
          return slot;
        }

        return {
          ...slot,
          x: clamp(snappedX, 0, 10000),
          y: clamp(snappedY, 0, 10000),
        };
      }));
      return;
    }

    if (currentInteraction.kind === 'pan') {
      const dx = touch.x - currentInteraction.startX;
      const dy = touch.y - currentInteraction.startY;
      const moved = currentInteraction.moved || Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD;

      interactionRef.current = {
        ...currentInteraction,
        moved,
      };

      setViewportClamped({
        scale: viewportRef.current.scale,
        tx: currentInteraction.startTx + dx,
        ty: currentInteraction.startTy + dy,
      });
      return;
    }

    if (currentInteraction.kind === 'pinch') {
      const currentViewport = viewportRef.current;
      interactionRef.current = {
        kind: 'pan',
        startX: touch.x,
        startY: touch.y,
        startTx: currentViewport.tx,
        startTy: currentViewport.ty,
        moved: false,
        slotTapCandidateId: null,
        edgeTapCandidateIndex: null,
      };
    }
  };

  const onResponderRelease = (): void => {
    const currentInteraction = interactionRef.current;

    if (currentInteraction.kind === 'endpoint-drag') {
      finalizeEndpointDrop();
    }

    if (currentInteraction.kind === 'pan' && !currentInteraction.moved) {
      if (editLayoutRef.current && currentInteraction.edgeTapCandidateIndex !== null) {
        setEdgeEditorIndex(currentInteraction.edgeTapCandidateIndex);
      } else if (currentInteraction.slotTapCandidateId) {
        handleSlotTap(currentInteraction.slotTapCandidateId);
      }
    }

    interactionRef.current = { kind: 'idle' };
  };

  const onResponderTerminate = (): void => {
    if (interactionRef.current.kind === 'endpoint-drag') {
      setDraggingEndpoint(null);
      draggingEndpointRef.current = null;
    }

    interactionRef.current = { kind: 'idle' };
  };

  const zoomByFactor = (factor: number): void => {
    const centerX = viewportSize.width / 2;
    const centerY = viewportSize.height / 2;
    const previous = viewportRef.current;
    const scale = clampScalar(previous.scale * factor, zoomLimits.minScale, zoomLimits.maxScale);
    const anchorWorldX = screenToWorldX(centerX, previous);
    const anchorWorldY = screenToWorldY(centerY, previous);

    setViewportClamped({
      scale,
      tx: centerX - anchorWorldX * scale,
      ty: centerY - anchorWorldY * scale,
    });
  };

  const selectedEdge = edgeEditorIndex !== null ? edges[edgeEditorIndex] : null;

  const updateSelectedEdge = (updater: (edge: Edge) => Edge): void => {
    if (edgeEditorIndex === null) {
      return;
    }

    setEdges((previous) => previous.map((edge, index) => (
      index === edgeEditorIndex ? updater(edge) : edge
    )));
  };

  const adjustSelectedEdgeWeight = (delta: number): void => {
    updateSelectedEdge((edge) => ({
      ...edge,
      weight: Math.max(1, edge.weight + delta),
    }));
  };

  const toggleSelectedEdgeMode = (): void => {
    updateSelectedEdge((edge) => {
      const mode = edge.render?.mode ?? 'straight';
      if (mode === 'straight') {
        return {
          ...edge,
          render: {
            mode: 'orthogonal',
            bend: getEdgeBendMode(edge),
            waypoints: edge.render?.waypoints,
          },
        };
      }

      return {
        ...edge,
        render: {
          mode: 'straight',
        },
      };
    });
  };

  const toggleSelectedEdgeBend = (): void => {
    updateSelectedEdge((edge) => ({
      ...edge,
      render: {
        mode: 'orthogonal',
        bend: getEdgeBendMode(edge) === 'hv' ? 'vh' : 'hv',
        waypoints: edge.render?.waypoints,
      },
    }));
  };

  const dropPreviewSlotId = draggingEndpoint?.targetSlotId;

  return (
    <Animated.View style={[styles.screen, { transform: [{ translateX: shakeX }] }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Tunnel Navigator</Text>
          <Text style={styles.subtitle}>
            {editLayoutMode
              ? 'Layout mode: drag slots, export graph.json'
              : endpoints.length === 2
                ? `${routes.length} shortest route${routes.length === 1 ? '' : 's'} highlighted`
                : 'Tap empty slots to place up to two endpoints'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            style={[styles.headerButton, editLayoutMode ? styles.headerButtonActive : null]}
            onPress={() => setEditLayoutMode((previous) => !previous)}
          >
            <Text style={[styles.headerButtonText, editLayoutMode ? styles.headerButtonTextActive : null]}>
              {editLayoutMode ? 'Done' : 'Edit layout'}
            </Text>
          </Pressable>

          {editLayoutMode ? (
            <Pressable
              style={styles.headerButton}
              onPress={() => setGridSizeIndex((previous) => (previous + 1) % GRID_SIZE_OPTIONS.length)}
            >
              <Text style={styles.headerButtonText}>Grid {gridSize}</Text>
            </Pressable>
          ) : null}

          {editLayoutMode ? (
            <Pressable style={styles.headerButton} onPress={() => setExportVisible(true)}>
              <Text style={styles.headerButtonText}>Export</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View
        ref={canvasRef}
        style={styles.canvas}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setViewportSize({ width, height });
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onResponderGrant}
        onResponderMove={onResponderMove}
        onResponderRelease={onResponderRelease}
        onResponderTerminate={onResponderTerminate}
        onResponderTerminationRequest={() => false}
      >
        <View style={styles.canvasBackdrop} />

        <View
          pointerEvents="none"
          style={[
            styles.world,
            {
              width: worldSize.width,
              height: worldSize.height,
              transform: [
                { translateX: viewport.tx },
                { translateY: viewport.ty },
                { scale: viewport.scale },
              ],
              ...(Platform.OS === 'web' ? ({ transformOrigin: '0px 0px' } as const) : null),
            },
          ]}
        >
          {editLayoutMode ? (
            <>
              {gridModel.xValues.map((x) => (
                <View
                  key={`grid-x-${x}`}
                  style={[
                    styles.gridLineVertical,
                    {
                      left: x,
                      top: gridModel.minY,
                      height: Math.max(1, gridModel.maxY - gridModel.minY),
                    },
                  ]}
                />
              ))}
              {gridModel.yValues.map((y) => (
                <View
                  key={`grid-y-${y}`}
                  style={[
                    styles.gridLineHorizontal,
                    {
                      top: y,
                      left: gridModel.minX,
                      width: Math.max(1, gridModel.maxX - gridModel.minX),
                    },
                  ]}
                />
              ))}
              {gridModel.xValues.map((x) => (
                <React.Fragment key={`grid-p-${x}`}>
                  {gridModel.yValues.map((y) => (
                    <View
                      key={`grid-p-${x}-${y}`}
                      style={[
                        styles.gridIntersection,
                        {
                          left: x - 1.5,
                          top: y - 1.5,
                        },
                      ]}
                    />
                  ))}
                </React.Fragment>
              ))}
            </>
          ) : null}

          {edges.map((edge, index) => {
            const isHighlighted = highlightedEdgeKeys.has(edgeKey(edge.from, edge.to));
            const segments = getEdgeSegments(edge, slotById);

            return segments.map((segment, segmentIndex) => {
              const dx = segment.x2 - segment.x1;
              const dy = segment.y2 - segment.y1;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length <= 0.001) {
                return null;
              }

              const angle = Math.atan2(dy, dx);

              return (
                <View
                  key={`${edge.from}-${edge.to}-${index}-${segmentIndex}`}
                  style={[
                    styles.edge,
                    {
                      left: (segment.x1 + segment.x2) / 2 - length / 2,
                      top: (segment.y1 + segment.y2) / 2 - (isHighlighted ? 2 : 1),
                      width: length,
                      height: isHighlighted ? 4 : 2,
                      backgroundColor: isHighlighted ? '#f7f7f7' : (EDGE_TYPE_COLORS[edge.type] ?? '#4a627f'),
                      opacity: isHighlighted ? 1 : 0.84,
                      transform: [{ rotate: `${angle}rad` }],
                    },
                  ]}
                />
              );
            });
          })}

          {slots.map((slot) => {
            const highlighted = highlightedSlotIds.has(slot.id);
            const isDropTarget = dropPreviewSlotId === slot.id;
            const isExitOnly = slot.node.exitOnly;

            return (
              <View key={slot.id} style={[styles.slotWrap, { left: slot.x - SLOT_RADIUS, top: slot.y - SLOT_RADIUS }]}>
                <View
                  style={[
                    styles.slot,
                    { borderColor: NODE_TYPE_COLORS[slot.node.type] ?? '#7f8a9b' },
                    isExitOnly ? styles.slotExitOnly : null,
                    highlighted ? styles.slotHighlighted : null,
                    isDropTarget ? styles.slotDropPreview : null,
                  ]}
                />
                <Text numberOfLines={editLayoutMode ? 3 : 2} style={styles.slotLabel}>
                  {slot.node.label}
                  {editLayoutMode ? `\n${Math.round(slot.x)}, ${Math.round(slot.y)}` : ''}
                </Text>
              </View>
            );
          })}

          {endpointOrder(endpoints).map((endpoint) => {
            const baseSlot = slotById.get(endpoint.slotId);
            if (!baseSlot) {
              return null;
            }

            const drag = draggingEndpoint?.endpointId === endpoint.id ? draggingEndpoint : null;
            const x = drag ? drag.worldX : baseSlot.x;
            const y = drag ? drag.worldY : baseSlot.y;
            const isStart = endpoint.id === 'start';

            return (
              <View
                key={endpoint.id}
                style={[
                  styles.endpointWrap,
                  {
                    left: x - ENDPOINT_RADIUS,
                    top: y - ENDPOINT_RADIUS,
                    opacity: drag ? 0.94 : 1,
                    transform: [{ scale: drag ? 1.07 : 1 }],
                  },
                ]}
              >
                <View style={[styles.endpoint, isStart ? styles.endpointStart : styles.endpointEnd]}>
                  <Text style={styles.endpointText}>{isStart ? 'A' : 'B'}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {blockedMessage ? (
          <View style={styles.blockedToast}>
            <Text style={styles.blockedToastText}>{blockedMessage}</Text>
          </View>
        ) : null}

        {draggingEndpoint ? (
          <View
            style={[
              styles.deleteZone,
              draggingEndpoint.overDeleteZone ? styles.deleteZoneActive : null,
            ]}
          >
            <Text style={styles.deleteZoneText}>Release here to delete endpoint</Text>
          </View>
        ) : null}

        <View style={styles.zoomControls}>
          <Pressable style={styles.zoomButton} onPress={() => zoomByFactor(1.16)}>
            <Text style={styles.zoomButtonText}>+</Text>
          </Pressable>
          <Pressable style={styles.zoomButton} onPress={() => zoomByFactor(0.86)}>
            <Text style={styles.zoomButtonText}>-</Text>
          </Pressable>
          <Pressable
            style={styles.zoomButton}
            onPress={() => {
              centerOnSlot(DEFAULT_CENTER_SLOT_ID, clampScalar(zoomLimits.minScale * 1.35, zoomLimits.minScale, zoomLimits.maxScale));
            }}
          >
            <Text style={styles.zoomButtonText}>C</Text>
          </Pressable>
        </View>
      </View>

      {routes.length > 0 ? (
        <View style={styles.routeInfoBar}>
          <Text style={styles.routeInfoText}>
            Distance: {routes[0].distance}  |  Equal shortest paths: {routes.length}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={selectedEdge !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEdgeEditorIndex(null)}
      >
        <View style={styles.edgeEditorOverlay}>
          <View style={styles.edgeEditorCard}>
            <Text style={styles.edgeEditorTitle}>Edit Edge</Text>
            {selectedEdge ? (
              <>
                <Text style={styles.edgeEditorMeta}>{`${selectedEdge.from} -> ${selectedEdge.to}`}</Text>
                <Text style={styles.edgeEditorMeta}>Type: {selectedEdge.type}</Text>

                <View style={styles.edgeEditorRow}>
                  <Text style={styles.edgeEditorLabel}>Weight</Text>
                  <View style={styles.edgeEditorStepper}>
                    <Pressable style={styles.edgeEditorSmallBtn} onPress={() => adjustSelectedEdgeWeight(-1)}>
                      <Text style={styles.edgeEditorSmallBtnText}>-</Text>
                    </Pressable>
                    <Text style={styles.edgeEditorValue}>{selectedEdge.weight}</Text>
                    <Pressable style={styles.edgeEditorSmallBtn} onPress={() => adjustSelectedEdgeWeight(1)}>
                      <Text style={styles.edgeEditorSmallBtnText}>+</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.edgeEditorRow}>
                  <Text style={styles.edgeEditorLabel}>Mode</Text>
                  <Pressable style={styles.edgeEditorActionBtn} onPress={toggleSelectedEdgeMode}>
                    <Text style={styles.edgeEditorActionBtnText}>
                      {selectedEdge.render?.mode ?? 'straight'}
                    </Text>
                  </Pressable>
                </View>

                {(selectedEdge.render?.mode ?? 'straight') === 'orthogonal' ? (
                  <View style={styles.edgeEditorRow}>
                    <Text style={styles.edgeEditorLabel}>Bend</Text>
                    <Pressable style={styles.edgeEditorActionBtn} onPress={toggleSelectedEdgeBend}>
                      <Text style={styles.edgeEditorActionBtnText}>{getEdgeBendMode(selectedEdge)}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

            <Pressable style={styles.edgeEditorCloseBtn} onPress={() => setEdgeEditorIndex(null)}>
              <Text style={styles.edgeEditorCloseBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={exportVisible} animationType="slide" onRequestClose={() => setExportVisible(false)}>
        <View style={styles.exportModal}>
          <View style={styles.exportHeader}>
            <Text style={styles.exportTitle}>Export graph.json</Text>
            <Pressable style={styles.exportCloseButton} onPress={() => setExportVisible(false)}>
              <Text style={styles.exportCloseButtonText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.exportHint}>
            Copy this JSON and replace src/data/graph.json. Layout x/y values are now embedded into nodes.
          </Text>

          <ScrollView style={styles.exportBody}>
            <Text selectable style={styles.exportCode}>{exportJson}</Text>
          </ScrollView>
        </View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d121a',
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#121a26',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2a3d',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    color: '#e9eff8',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 3,
    color: '#9ba9bf',
    fontSize: 12,
    lineHeight: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1d2a3f',
    borderWidth: 1,
    borderColor: '#2e425f',
  },
  headerButtonActive: {
    backgroundColor: '#2a7af5',
    borderColor: '#4f95ff',
  },
  headerButtonText: {
    color: '#d8e4f7',
    fontSize: 12,
    fontWeight: '600',
  },
  headerButtonTextActive: {
    color: '#f3f8ff',
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
  },
  canvasBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0e1724',
  },
  world: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  edge: {
    position: 'absolute',
    borderRadius: 6,
  },
  gridLineVertical: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(147, 170, 201, 0.18)',
  },
  gridLineHorizontal: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(147, 170, 201, 0.18)',
  },
  gridIntersection: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(210, 224, 244, 0.55)',
  },
  slotWrap: {
    position: 'absolute',
    width: SLOT_RADIUS * 2,
    alignItems: 'center',
  },
  slot: {
    width: SLOT_RADIUS * 2,
    height: SLOT_RADIUS * 2,
    borderRadius: SLOT_RADIUS,
    borderWidth: 2,
    backgroundColor: '#132033',
    shadowColor: '#08111f',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 4,
  },
  slotExitOnly: {
    borderStyle: 'dashed',
    borderColor: '#ffbe70',
    backgroundColor: '#2f2415',
  },
  slotHighlighted: {
    borderColor: '#ffffff',
    backgroundColor: '#21395c',
  },
  slotDropPreview: {
    borderColor: '#f6e05e',
    borderWidth: 3,
    backgroundColor: '#3c3416',
  },
  slotLabel: {
    width: 132,
    marginTop: 7,
    marginLeft: -46,
    color: '#a3b8d8',
    fontSize: 9.5,
    textAlign: 'center',
    lineHeight: 12.5,
  },
  endpointWrap: {
    position: 'absolute',
    width: ENDPOINT_RADIUS * 2,
    height: ENDPOINT_RADIUS * 2,
  },
  endpoint: {
    width: ENDPOINT_RADIUS * 2,
    height: ENDPOINT_RADIUS * 2,
    borderRadius: ENDPOINT_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  endpointStart: {
    backgroundColor: '#2b6fc5',
    borderColor: '#91c2ff',
  },
  endpointEnd: {
    backgroundColor: '#20915f',
    borderColor: '#8de5bc',
  },
  endpointText: {
    color: '#f4f8ff',
    fontWeight: '800',
    fontSize: 16,
  },
  blockedToast: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    backgroundColor: '#41222d',
    borderColor: '#7d3b50',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  blockedToastText: {
    color: '#f9d6df',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  deleteZone: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: DELETE_ZONE_HEIGHT,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#8f4655',
    backgroundColor: 'rgba(88, 30, 44, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteZoneActive: {
    borderColor: '#ff8ea7',
    backgroundColor: 'rgba(130, 30, 55, 0.94)',
  },
  deleteZoneText: {
    color: '#ffd5de',
    fontWeight: '700',
    fontSize: 14,
  },
  zoomControls: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    gap: 8,
  },
  zoomButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#1d2a3f',
    borderWidth: 1,
    borderColor: '#2d425e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomButtonText: {
    color: '#dce8fa',
    fontSize: 20,
    fontWeight: '700',
    marginTop: -1,
  },
  routeInfoBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1f2a3d',
    backgroundColor: '#101925',
  },
  routeInfoText: {
    color: '#cfddf3',
    fontSize: 12,
    textAlign: 'center',
  },
  edgeEditorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6, 10, 16, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  edgeEditorCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    backgroundColor: '#111a28',
    borderWidth: 1,
    borderColor: '#2a3f5e',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  edgeEditorTitle: {
    color: '#eef5ff',
    fontSize: 16,
    fontWeight: '700',
  },
  edgeEditorMeta: {
    color: '#a4b7d5',
    fontSize: 11,
  },
  edgeEditorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  edgeEditorLabel: {
    color: '#d6e4fa',
    fontSize: 13,
    fontWeight: '600',
  },
  edgeEditorStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  edgeEditorSmallBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#22324c',
    borderWidth: 1,
    borderColor: '#355077',
    justifyContent: 'center',
    alignItems: 'center',
  },
  edgeEditorSmallBtnText: {
    color: '#e4efff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
  },
  edgeEditorValue: {
    width: 28,
    color: '#e4efff',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  edgeEditorActionBtn: {
    minWidth: 112,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#22324c',
    borderWidth: 1,
    borderColor: '#355077',
    alignItems: 'center',
  },
  edgeEditorActionBtnText: {
    color: '#dce8fa',
    fontSize: 12,
    fontWeight: '600',
  },
  edgeEditorCloseBtn: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: '#2a7af5',
    alignItems: 'center',
    paddingVertical: 10,
  },
  edgeEditorCloseBtnText: {
    color: '#f4f8ff',
    fontWeight: '700',
    fontSize: 13,
  },
  exportModal: {
    flex: 1,
    backgroundColor: '#0d121a',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
  },
  exportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  exportTitle: {
    color: '#e9eff8',
    fontSize: 18,
    fontWeight: '700',
  },
  exportCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#1d2a3f',
    borderWidth: 1,
    borderColor: '#2f435f',
  },
  exportCloseButtonText: {
    color: '#d8e4f7',
    fontWeight: '600',
    fontSize: 12,
  },
  exportHint: {
    color: '#99a8be',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  exportBody: {
    flex: 1,
    backgroundColor: '#111a28',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2d44',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  exportCode: {
    color: '#b7d3ff',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 16,
  },
});
