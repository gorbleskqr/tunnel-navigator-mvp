
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { buildAdjacencyList, graph, graphLayout } from '../engine/graph';
import {
  clamp,
  clampViewport,
  distance,
  worldToScreenX,
  worldToScreenY,
  screenToWorldX,
  screenToWorldY,
} from '../services/geometryService';
import {
  buildSlotsFromGraph,
  clampScalar,
  exportLayout,
  exportTopology,
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
const DEFAULT_CENTER_SLOT_ID = 'nicol_building';
const GRID_SIZE_OPTIONS = [40, 80, 120] as const;
const LABEL_BASE_WIDTH = 124;
const LABEL_COMPACT_WIDTH = 96;
const LABEL_JUNCTION_WIDTH = 148;
const LABEL_JUNCTION_COMPACT_WIDTH = 108;
const LABEL_JUNCTION_MAX_WIDTH = 248;
const LABEL_LINE_HEIGHT = 11.2;
const LABEL_VERTICAL_PADDING = 1;
const LABEL_HORIZONTAL_PADDING = 12;
const LABEL_MIN_WIDTH = 56;
const LABEL_VIEWPORT_MARGIN = 20;
const LABEL_LONG_PRESS_MS = 380;
const LABEL_EXPAND_DURATION_MS = 1500;
const LABEL_HOLD_FOCUS_MS = 1400;
const WORLD_BOUNDS_PADDING = 180;
const LABEL_LOW_ZOOM_PROGRESS_THRESHOLD = 0.24;
const LABEL_MEDIUM_ZOOM_PROGRESS_THRESHOLD = 0.5;
const LABEL_FULL_TEXT_PROGRESS_THRESHOLD = 0.84;
const LABEL_JUNCTION_CLUSTER_FULL_TEXT_PROGRESS_THRESHOLD = 0.72;
const HOLD_TO_DELETE_MS = 320;
const ENDPOINT_INDICATOR_MARGIN = 26;
const ENDPOINT_INDICATOR_CLEARANCE = 54;
const ENDPOINT_INDICATOR_STEP = 26;
const ENDPOINT_INDICATOR_TRIGGER_RATIO = 0.72;
const DELETE_PROMPT_HIDE_MS = 2200;
const DELETE_PROMPT_WIDTH = 74;
const DELETE_PROMPT_HEIGHT = 32;
const DELETE_PROMPT_OFFSET_Y = 52;
const ROUTE_DIRECTION_MARKER_SPACING = 56;
const ROUTE_DIRECTION_MARKER_MIN_LENGTH = 44;
const LEVEL_CHANGE_ICON_MIN_LENGTH = 52;
const LABEL_ROUTE_OCCLUSION_BUFFER = 8;
const LABEL_ROUTE_ANCHORED_OCCLUSION_BUFFER = 4;
const TOOLS_DOCK_ICON_SIZE = 28;
const TOOLS_DOCK_ICON_WRAP_SIZE = 32;
const TOOLS_HOLD_PROGRESS_WIDTH = 164;
const TOOLS_CENTER_HOLD_ICON_SIZE = 104;
const TOOLS_CENTER_HOLD_WRAP_SIZE = 112;
const TOOL_ACTION_HOLD_MS = 820;
const ROUTE_INFO_AUTO_HIDE_MS = 2600;
// Keep layout editing local via .env.local so production builds stay read-only.
const EDIT_LAYOUT_ENABLED = process.env.EXPO_PUBLIC_ENABLE_LAYOUT_EDIT === '1';
const DEBUG_UI_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_DEBUG_UI === '1';

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

const ROUTE_COLORS = ['#7fc7ff', '#8de4b8', '#ffd27a', '#ff9fab', '#b8b2ff', '#7ee7e1'] as const;
const SHARED_ROUTE_COLOR = '#f2f6ff';

type InteractionState =
  | { kind: 'idle' }
  | {
    kind: 'pan';
    startX: number;
    startY: number;
    startedAt: number;
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
    startX: number;
    startY: number;
    moved: boolean;
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
  targetSlotId: string | null;
}

interface DeletePromptState {
  endpointId: Endpoint['id'];
  x: number;
  y: number;
}

interface EdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LabelCandidate {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  alternateTop: number | null;
  alternateBottom: number | null;
  priority: number;
  pinned: boolean;
  routeAnchored: boolean;
  occludesHighlightedRoute: boolean;
}

interface LabelLayout {
  left: number;
  top: number;
  occludesHighlightedRoute: boolean;
}

interface ExpandedLabelAnchor {
  slotId: string;
  left: number;
  top: number;
}

interface LabelPresentation {
  text: string;
  lines: number;
  width: number;
  height: number;
}

interface LabelBuildOptions {
  maxWidth: number;
  minWidth: number;
  maxLines: number;
  widthBuffer?: number;
}

interface TapPulseState {
  x: number;
  y: number;
  key: number;
}

interface EndpointIndicator {
  id: Endpoint['id'];
  slotId: string;
  x: number;
  y: number;
  angle: number;
}

type InfoTab = 'route' | 'legend';
type HoldToolAction = 'swap' | 'clear';

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

function labelsOverlap(a: LabelCandidate, b: LabelCandidate): boolean {
  return !(
    a.right < b.left - 8
    || a.left > b.right + 8
    || a.bottom < b.top - 4
    || a.top > b.bottom + 4
  );
}

function rectanglesOverlap(
  aLeft: number,
  aTop: number,
  aRight: number,
  aBottom: number,
  bLeft: number,
  bTop: number,
  bRight: number,
  bBottom: number,
  padX = 0,
  padY = 0,
): boolean {
  return !(
    aRight < bLeft - padX
    || aLeft > bRight + padX
    || aBottom < bTop - padY
    || aTop > bBottom + padY
  );
}

function pointInRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return x >= left && x <= right && y >= top && y <= bottom;
}

function segmentCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    px >= Math.min(ax, bx) - 0.0001
    && px <= Math.max(ax, bx) + 0.0001
    && py >= Math.min(ay, by) - 0.0001
    && py <= Math.max(ay, by) + 0.0001
  );
}

function segmentsIntersect(
  a1x: number,
  a1y: number,
  a2x: number,
  a2y: number,
  b1x: number,
  b1y: number,
  b2x: number,
  b2y: number,
): boolean {
  const d1 = segmentCross(a1x, a1y, a2x, a2y, b1x, b1y);
  const d2 = segmentCross(a1x, a1y, a2x, a2y, b2x, b2y);
  const d3 = segmentCross(b1x, b1y, b2x, b2y, a1x, a1y);
  const d4 = segmentCross(b1x, b1y, b2x, b2y, a2x, a2y);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (Math.abs(d1) <= 0.0001 && pointOnSegment(a1x, a1y, a2x, a2y, b1x, b1y)) {
    return true;
  }
  if (Math.abs(d2) <= 0.0001 && pointOnSegment(a1x, a1y, a2x, a2y, b2x, b2y)) {
    return true;
  }
  if (Math.abs(d3) <= 0.0001 && pointOnSegment(b1x, b1y, b2x, b2y, a1x, a1y)) {
    return true;
  }
  if (Math.abs(d4) <= 0.0001 && pointOnSegment(b1x, b1y, b2x, b2y, a2x, a2y)) {
    return true;
  }

  return false;
}

function segmentIntersectsRect(
  segment: EdgeSegment,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  if (
    pointInRect(segment.x1, segment.y1, left, top, right, bottom)
    || pointInRect(segment.x2, segment.y2, left, top, right, bottom)
  ) {
    return true;
  }

  return (
    segmentsIntersect(segment.x1, segment.y1, segment.x2, segment.y2, left, top, right, top)
    || segmentsIntersect(segment.x1, segment.y1, segment.x2, segment.y2, right, top, right, bottom)
    || segmentsIntersect(segment.x1, segment.y1, segment.x2, segment.y2, right, bottom, left, bottom)
    || segmentsIntersect(segment.x1, segment.y1, segment.x2, segment.y2, left, bottom, left, top)
  );
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

function estimateTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') {
      width += 2.9;
    } else if (/[ilI1'`,.:;|!]/.test(ch)) {
      width += 3.3;
    } else if (/[MW@#%&]/.test(ch)) {
      width += 7.2;
    } else if (/[A-Z0-9]/.test(ch)) {
      width += 6.2;
    } else if (/[\/\\()\-\+]/.test(ch)) {
      width += 4.5;
    } else {
      width += 5.4;
    }
  }
  return width;
}

function trimLineToWidth(text: string, maxInnerWidth: number): string {
  if (estimateTextWidth(text) <= maxInnerWidth) {
    return text;
  }

  let trimmed = text.trimEnd();
  const ellipsis = '...';
  while (trimmed.length > 0 && estimateTextWidth(`${trimmed}${ellipsis}`) > maxInnerWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return `${trimmed}${ellipsis}`;
}

function wrapLongToken(token: string, maxInnerWidth: number): string[] {
  if (token.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';
  for (const ch of token) {
    const candidate = `${current}${ch}`;
    if (current.length > 0 && estimateTextWidth(candidate) > maxInnerWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function wrapTextToLines(text: string, maxInnerWidth: number, maxLines: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [''];
  }

  const rawLines = trimmed.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const sourceLines = rawLines.length > 0 ? rawLines : [trimmed];
  const wrapped: string[] = [];

  for (const sourceLine of sourceLines) {
    const words = sourceLine.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const next = current.length > 0 ? `${current} ${word}` : word;
      if (estimateTextWidth(next) <= maxInnerWidth) {
        current = next;
        continue;
      }

      if (current.length > 0) {
        wrapped.push(current);
        current = '';
      }

      if (estimateTextWidth(word) <= maxInnerWidth) {
        current = word;
      } else {
        const tokenParts = wrapLongToken(word, maxInnerWidth);
        wrapped.push(...tokenParts.slice(0, -1));
        current = tokenParts[tokenParts.length - 1] ?? '';
      }
    }

    if (current.length > 0) {
      wrapped.push(current);
    }
  }

  if (wrapped.length <= maxLines) {
    return wrapped;
  }

  const limited = wrapped.slice(0, maxLines);
  const lastIndex = limited.length - 1;
  limited[lastIndex] = trimLineToWidth(limited[lastIndex], maxInnerWidth);
  return limited;
}

function buildLabelPresentation(text: string, options: LabelBuildOptions): LabelPresentation {
  const maxInnerWidth = Math.max(24, options.maxWidth - LABEL_HORIZONTAL_PADDING);
  const lines = wrapTextToLines(text, maxInnerWidth, options.maxLines);
  const widestLine = lines.reduce((widest, line) => Math.max(widest, estimateTextWidth(line)), 0);
  const widthBuffer = options.widthBuffer ?? 6;
  const width = clamp(
    Math.ceil(widestLine + LABEL_HORIZONTAL_PADDING + widthBuffer),
    options.minWidth,
    options.maxWidth,
  );

  return {
    text: lines.join('\n'),
    lines: Math.max(1, lines.length),
    width,
    height: LABEL_LINE_HEIGHT * Math.max(1, lines.length) + LABEL_VERTICAL_PADDING * 2,
  };
}

function getJunctionCompactLabel(aliasLabels: string[]): string {
  if (aliasLabels.length === 0) {
    return '';
  }

  if (aliasLabels.length === 1) {
    return aliasLabels[0];
  }

  // Keep 2-short-name junctions compact and readable (e.g., P1/ML).
  if (
    aliasLabels.length === 2
    && aliasLabels[0].length <= 5
    && aliasLabels[1].length <= 5
  ) {
    return `${aliasLabels[0]}/${aliasLabels[1]}`;
  }

  const base = aliasLabels[0].trim();
  return `${base} +${aliasLabels.length - 1}`;
}

function getLabelPresentation(
  slot: Slot,
  editLayoutMode: boolean,
  emphasized: boolean,
  highZoomExpanded: boolean,
): LabelPresentation | null {
  if (editLayoutMode) {
    return {
      text: `${slot.node.label}\n${Math.round(slot.x)}, ${Math.round(slot.y)}`,
      lines: 3,
      width: LABEL_BASE_WIDTH,
      height: LABEL_LINE_HEIGHT * 3 + LABEL_VERTICAL_PADDING * 2,
    };
  }

  if (slot.node.type === 'intersection') {
    return null;
  }

  if (slot.node.type === 'junction') {
    const aliasLabels = slot.node.aliases
      .map((alias) => alias.label.trim())
      .filter((label) => label.length > 0);

    if (aliasLabels.length === 0) {
      return null;
    }

    if (!emphasized) {
      const compact = getJunctionCompactLabel(aliasLabels);
      return buildLabelPresentation(compact, {
        minWidth: Math.min(LABEL_MIN_WIDTH, LABEL_JUNCTION_COMPACT_WIDTH),
        maxWidth: LABEL_JUNCTION_COMPACT_WIDTH,
        maxLines: 1,
        widthBuffer: 4,
      });
    }

    const visibleAliasCount = highZoomExpanded ? 10 : 6;
    const lines = aliasLabels.length > (visibleAliasCount + 1)
      ? [...aliasLabels.slice(0, visibleAliasCount), `+${aliasLabels.length - visibleAliasCount} more`]
      : aliasLabels;
    return buildLabelPresentation(lines.join('\n'), {
      minWidth: Math.max(72, LABEL_MIN_WIDTH),
      maxWidth: LABEL_JUNCTION_MAX_WIDTH,
      maxLines: highZoomExpanded ? 10 : 7,
      widthBuffer: 12,
    });
  }

  const trimmedLabel = slot.node.label.trim();
  if (trimmedLabel.length === 0) {
    return null;
  }

  if (!emphasized) {
    return buildLabelPresentation(trimmedLabel, {
      minWidth: LABEL_MIN_WIDTH,
      maxWidth: LABEL_COMPACT_WIDTH,
      maxLines: 1,
      widthBuffer: 4,
    });
  }

  return buildLabelPresentation(trimmedLabel, {
    minWidth: 70,
    maxWidth: highZoomExpanded ? (LABEL_BASE_WIDTH + 96) : (LABEL_BASE_WIDTH + 40),
    maxLines: highZoomExpanded ? 7 : 5,
    widthBuffer: highZoomExpanded ? 18 : 12,
  });
}

function hasUsableLabel(slot: Slot): boolean {
  if (slot.node.label.trim().length > 0) {
    return true;
  }

  return slot.node.aliases.some((alias) => alias.label.trim().length > 0);
}

function getDirectionMarkerOffsets(length: number): number[] {
  if (length < ROUTE_DIRECTION_MARKER_MIN_LENGTH) {
    return [];
  }

  const markerCount = Math.max(1, Math.min(3, Math.floor(length / ROUTE_DIRECTION_MARKER_SPACING)));
  const spacing = length / (markerCount + 1);
  return Array.from({ length: markerCount }, (_, index) => spacing * (index + 1));
}

function getStairStepOffsets(length: number): number[] {
  if (length < 28) {
    return [];
  }

  const stepCount = Math.max(2, Math.min(8, Math.floor(length / 20)));
  const spacing = length / (stepCount + 1);
  return Array.from({ length: stepCount }, (_, index) => spacing * (index + 1));
}

export default function GraphCanvas() {
  const windowSize = useWindowDimensions();
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
  const bottomInset = Platform.OS === 'android' ? 44 : 0;
  const [slots, setSlots] = useState<Slot[]>(() => buildSlotsFromGraph(graph, graphLayout));
  const [edges, setEdges] = useState<Edge[]>(() => graph.edges.map((edge) => ({ ...edge })));
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [edgeEditorIndex, setEdgeEditorIndex] = useState<number | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] = useState<DraggingEndpointState | null>(null);
  const [slotTapPulse, setSlotTapPulse] = useState<TapPulseState | null>(null);
  const [screenTapPulse, setScreenTapPulse] = useState<TapPulseState | null>(null);
  const [toolsDockOpen, setToolsDockOpen] = useState(false);
  const [toolsPinned, setToolsPinned] = useState(false);
  const [activeToolHoldAction, setActiveToolHoldAction] = useState<HoldToolAction | null>(null);
  const [routeInfoOpen, setRouteInfoOpen] = useState(false);
  const [routeInfoPinned, setRouteInfoPinned] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>('route');
  const [expandedLabelSlotId, setExpandedLabelSlotId] = useState<string | null>(null);
  const [expandedLabelAnchor, setExpandedLabelAnchor] = useState<ExpandedLabelAnchor | null>(null);
  const [holdFocusSlotId, setHoldFocusSlotId] = useState<string | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePromptState | null>(null);
  const [logoHintVisible, setLogoHintVisible] = useState(false);
  const [focusHintVisible, setFocusHintVisible] = useState(false);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const [gridSizeIndex, setGridSizeIndex] = useState(1);
  const defaultCenterSlotId = graphLayout.view?.defaultCenterSlotId ?? DEFAULT_CENTER_SLOT_ID;

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
  const introAnim = useRef(new Animated.Value(0)).current;
  const routeGlow = useRef(new Animated.Value(0)).current;
  const routeReveal = useRef(new Animated.Value(0)).current;
  const slotTapPulseAnim = useRef(new Animated.Value(0)).current;
  const screenTapPulseAnim = useRef(new Animated.Value(0)).current;
  const logoHintAnim = useRef(new Animated.Value(0)).current;
  const focusHintAnim = useRef(new Animated.Value(0)).current;
  const toolsDockAnim = useRef(new Animated.Value(0)).current;
  const swapHoldAnim = useRef(new Animated.Value(0)).current;
  const clearHoldAnim = useRef(new Animated.Value(0)).current;
  const canvasRef = useRef<View | null>(null);
  const logoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpointHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletePromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeToolHoldActionRef = useRef<HoldToolAction | null>(null);
  const routeInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  slotsRef.current = slots;
  endpointsRef.current = endpoints;
  viewportRef.current = viewport;
  viewportSizeRef.current = viewportSize;
  draggingEndpointRef.current = draggingEndpoint;
  editLayoutRef.current = editLayoutMode;

  const triggerHaptic = (kind: 'light' | 'success' | 'warning'): void => {
    if (Platform.OS === 'web') {
      return;
    }

    try {
      if (kind === 'light') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }

      if (kind === 'warning') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Best effort only.
    }
  };

  const triggerTapPulse = (slotId: string): void => {
    const slot = slotById.get(slotId);
    if (!slot) {
      return;
    }

    setSlotTapPulse({
      x: worldToScreenX(slot.x, viewportRef.current),
      y: worldToScreenY(slot.y, viewportRef.current),
      key: Date.now(),
    });

    slotTapPulseAnim.setValue(0);
    Animated.timing(slotTapPulseAnim, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setSlotTapPulse(null);
    });
  };

  const triggerScreenTapPulse = (x: number, y: number): void => {
    setScreenTapPulse({
      x,
      y,
      key: Date.now(),
    });

    screenTapPulseAnim.setValue(0);
    Animated.timing(screenTapPulseAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setScreenTapPulse(null);
    });
  };

  const showLogoHint = (): void => {
    setRouteInfoOpen(false);
    setFocusHintVisible(false);
    focusHintAnim.setValue(0);

    setLogoHintVisible(true);
    logoHintAnim.stopAnimation();
    logoHintAnim.setValue(0);
    Animated.timing(logoHintAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (logoHintTimerRef.current) {
      clearTimeout(logoHintTimerRef.current);
    }

    logoHintTimerRef.current = setTimeout(() => {
      Animated.timing(logoHintAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setLogoHintVisible(false);
        logoHintTimerRef.current = null;
      });
    }, 2200);
  };

  const hideLogoHint = (): void => {
    if (logoHintTimerRef.current) {
      clearTimeout(logoHintTimerRef.current);
      logoHintTimerRef.current = null;
    }

    if (!logoHintVisible) {
      return;
    }

    Animated.timing(logoHintAnim, {
      toValue: 0,
      duration: 170,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setLogoHintVisible(false);
    });
  };

  const handleLogoPress = (): void => {
    if (logoHintVisible) {
      hideLogoHint();
      return;
    }

    showLogoHint();
  };

  const showExpandedLabel = (slotId: string): void => {
    const slot = slotById.get(slotId);
    showHoldFocus(slotId);
    if (!editLayoutRef.current && slot?.node.type === 'intersection') {
      triggerTapPulse(slotId);
      triggerHaptic('light');
      return;
    }

    if (!editLayoutRef.current && slot && viewportSize.width > 0 && viewportSize.height > 0) {
      const slotScreenX = worldToScreenX(slot.x, viewportRef.current);
      const slotScreenY = worldToScreenY(slot.y, viewportRef.current);
      const slotRadius = clamp(SLOT_RADIUS * viewportRef.current.scale, 8, 30);
      const visibleMargin = slotRadius * 0.35;
      const mostlyVisible = (
        slotScreenX >= visibleMargin
        && slotScreenX <= viewportSize.width - visibleMargin
        && slotScreenY >= visibleMargin
        && slotScreenY <= viewportSize.height - visibleMargin
      );
      if (!mostlyVisible) {
        triggerTapPulse(slotId);
        triggerHaptic('light');
        return;
      }
    }

    triggerTapPulse(slotId);
    triggerHaptic('light');

    const currentLayout = labelLayoutById.get(slotId);

    if (currentLayout) {
      setExpandedLabelAnchor({
        slotId,
        left: currentLayout.left,
        top: currentLayout.top,
      });
    } else {
      setExpandedLabelAnchor(null);
    }
    setExpandedLabelSlotId(slotId);
    if (expandedLabelTimerRef.current) {
      clearTimeout(expandedLabelTimerRef.current);
    }

    expandedLabelTimerRef.current = setTimeout(() => {
      setExpandedLabelSlotId((previous) => (previous === slotId ? null : previous));
      expandedLabelTimerRef.current = null;
    }, LABEL_EXPAND_DURATION_MS);
  };

  const clearExpandedLabel = (): void => {
    if (expandedLabelTimerRef.current) {
      clearTimeout(expandedLabelTimerRef.current);
      expandedLabelTimerRef.current = null;
    }
    setExpandedLabelAnchor(null);
    setExpandedLabelSlotId(null);
  };

  const showHoldFocus = (slotId: string): void => {
    setHoldFocusSlotId(slotId);
    if (holdFocusTimerRef.current) {
      clearTimeout(holdFocusTimerRef.current);
    }
    holdFocusTimerRef.current = setTimeout(() => {
      setHoldFocusSlotId((previous) => (previous === slotId ? null : previous));
      holdFocusTimerRef.current = null;
    }, LABEL_HOLD_FOCUS_MS);
  };

  const clearEndpointHoldTimer = (): void => {
    if (endpointHoldTimerRef.current) {
      clearTimeout(endpointHoldTimerRef.current);
      endpointHoldTimerRef.current = null;
    }
  };

  const clearRouteInfoAutoHideTimer = (): void => {
    if (routeInfoTimerRef.current) {
      clearTimeout(routeInfoTimerRef.current);
      routeInfoTimerRef.current = null;
    }
  };

  const getToolHoldAnim = (action: HoldToolAction): Animated.Value => {
    return action === 'swap' ? swapHoldAnim : clearHoldAnim;
  };

  const clearToolHoldTimer = (): void => {
    if (toolHoldTimerRef.current) {
      clearTimeout(toolHoldTimerRef.current);
      toolHoldTimerRef.current = null;
    }
  };

  const cancelToolHold = (): void => {
    clearToolHoldTimer();
    const active = activeToolHoldActionRef.current;
    if (!active) {
      return;
    }

    const anim = getToolHoldAnim(active);
    anim.stopAnimation();
    Animated.timing(anim, {
      toValue: 0,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    activeToolHoldActionRef.current = null;
    setActiveToolHoldAction(null);
  };

  const clearLabelHoldTimer = (): void => {
    if (labelHoldTimerRef.current) {
      clearTimeout(labelHoldTimerRef.current);
      labelHoldTimerRef.current = null;
    }
  };

  const hideDeletePrompt = (): void => {
    if (deletePromptTimerRef.current) {
      clearTimeout(deletePromptTimerRef.current);
      deletePromptTimerRef.current = null;
    }
    setDeletePrompt(null);
  };

  const showDeletePromptForEndpoint = (endpointId: Endpoint['id']): void => {
    const position = getEndpointWorldPosition(endpointId);
    if (!position) {
      return;
    }

    const screenX = worldToScreenX(position.x, viewportRef.current);
    const screenY = worldToScreenY(position.y, viewportRef.current);
    const maxX = Math.max(8, viewportSizeRef.current.width - DELETE_PROMPT_WIDTH - 8);
    const maxY = Math.max(8, viewportSizeRef.current.height - DELETE_PROMPT_HEIGHT - 8);

    setDeletePrompt({
      endpointId,
      x: clamp(screenX - DELETE_PROMPT_WIDTH / 2, 8, maxX),
      y: clamp(screenY - DELETE_PROMPT_OFFSET_Y, 8, maxY),
    });

    if (deletePromptTimerRef.current) {
      clearTimeout(deletePromptTimerRef.current);
    }

    deletePromptTimerRef.current = setTimeout(() => {
      setDeletePrompt(null);
      deletePromptTimerRef.current = null;
    }, DELETE_PROMPT_HIDE_MS);
  };

  const showFocusHint = (): void => {
    setRouteInfoOpen(false);
    setLogoHintVisible(false);
    logoHintAnim.setValue(0);

    setFocusHintVisible(true);
    focusHintAnim.stopAnimation();
    focusHintAnim.setValue(0);
    Animated.timing(focusHintAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (focusHintTimerRef.current) {
      clearTimeout(focusHintTimerRef.current);
    }

    focusHintTimerRef.current = setTimeout(() => {
      Animated.timing(focusHintAnim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setFocusHintVisible(false);
        focusHintTimerRef.current = null;
      });
    }, 1600);
  };

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

  const bounds = useMemo(() => getWorldBounds(slots, WORLD_BOUNDS_PADDING), [slots]);
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

  const routeSignature = useMemo(() => {
    return routes
      .map((route) => route.path.join('>'))
      .join('|');
  }, [routes]);

  const routeEdgeColors = useMemo(() => {
    const colorByEdge = new Map<string, string>();

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const route = routes[routeIndex];
      const routeColor = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];

      for (let edgeIndex = 0; edgeIndex < route.path.length - 1; edgeIndex += 1) {
        const key = edgeKey(route.path[edgeIndex], route.path[edgeIndex + 1]);
        const existing = colorByEdge.get(key);

        if (!existing) {
          colorByEdge.set(key, routeColor);
        } else if (existing !== routeColor) {
          colorByEdge.set(key, SHARED_ROUTE_COLOR);
        }
      }
    }

    return colorByEdge;
  }, [routes]);

  const highlightedRouteScreenSegments = useMemo<EdgeSegment[]>(() => {
    const segments: EdgeSegment[] = [];
    if (routeEdgeColors.size === 0) {
      return segments;
    }

    for (const edge of edges) {
      if (!routeEdgeColors.has(edgeKey(edge.from, edge.to))) {
        continue;
      }

      const worldSegments = getEdgeSegments(edge, slotById);
      for (const segment of worldSegments) {
        const screenSegment: EdgeSegment = {
          x1: worldToScreenX(segment.x1, viewport),
          y1: worldToScreenY(segment.y1, viewport),
          x2: worldToScreenX(segment.x2, viewport),
          y2: worldToScreenY(segment.y2, viewport),
        };
        segments.push(screenSegment);
      }
    }

    return segments;
  }, [edges, routeEdgeColors, slotById, viewport]);

  const primaryRouteEdgeFlow = useMemo(() => {
    const flowByKey = new Map<string, { index: number; from: string; to: string }>();
    const primary = routes[0];
    if (!primary || primary.path.length < 2) {
      return flowByKey;
    }

    for (let i = 0; i < primary.path.length - 1; i += 1) {
      flowByKey.set(edgeKey(primary.path[i], primary.path[i + 1]), {
        index: i,
        from: primary.path[i],
        to: primary.path[i + 1],
      });
    }

    return flowByKey;
  }, [routes]);

  const primaryRouteEdgeIndex = useMemo(() => {
    const indexByKey = new Map<string, number>();
    for (const [key, flow] of primaryRouteEdgeFlow.entries()) {
      indexByKey.set(key, flow.index);
    }

    return indexByKey;
  }, [primaryRouteEdgeFlow]);

  useEffect(() => {
    const primaryCount = primaryRouteEdgeIndex.size;
    routeReveal.stopAnimation();
    routeReveal.setValue(0);

    if (primaryCount === 0) {
      return;
    }

    Animated.timing(routeReveal, {
      toValue: primaryCount,
      duration: Math.max(520, primaryCount * 180),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [primaryRouteEdgeIndex, routeReveal, routeSignature]);

  const highlightedSlotIds = useMemo(() => {
    const ids = new Set<string>();

    for (const route of routes) {
      for (const slotId of route.path) {
        ids.add(slotId);
      }
    }

    return ids;
  }, [routes]);

  const endpointSlotIds = useMemo(() => {
    return new Set(endpoints.map((endpoint) => endpoint.slotId));
  }, [endpoints]);

  const importantLowZoomSlotIds = useMemo(() => {
    const degreeBySlotId = new Map<string, number>();
    const levelChangeConnectedSlotIds = new Set<string>();

    for (const slot of slots) {
      degreeBySlotId.set(slot.id, 0);
    }

    for (const edge of edges) {
      degreeBySlotId.set(edge.from, (degreeBySlotId.get(edge.from) ?? 0) + 1);
      degreeBySlotId.set(edge.to, (degreeBySlotId.get(edge.to) ?? 0) + 1);

      if (edge.type === 'stairs' || edge.type === 'ramp') {
        levelChangeConnectedSlotIds.add(edge.from);
        levelChangeConnectedSlotIds.add(edge.to);
      }
    }

    const importantIds = new Set<string>();
    for (const slot of slots) {
      const isInteractionTarget = endpointSlotIds.has(slot.id)
        || highlightedSlotIds.has(slot.id)
        || expandedLabelSlotId === slot.id
        || holdFocusSlotId === slot.id;
      const isPortal = slot.node.type === 'exterior'
        || slot.node.exitOnly
        || slot.node.aliases.some((alias) => alias.type === 'exterior');
      const isLevelChange = slot.node.type === 'stairs' || levelChangeConnectedSlotIds.has(slot.id);
      const highConnectivityNamed = (degreeBySlotId.get(slot.id) ?? 0) >= 3
        && slot.node.type !== 'intersection'
        && hasUsableLabel(slot);

      if (isInteractionTarget || isPortal || isLevelChange || highConnectivityNamed) {
        importantIds.add(slot.id);
      }
    }

    return importantIds;
  }, [
    edges,
    endpointSlotIds,
    expandedLabelSlotId,
    highlightedSlotIds,
    holdFocusSlotId,
    slots,
  ]);

  const exportTopologyJson = useMemo(() => {
    return JSON.stringify(exportTopology(graph, edges), null, 2);
  }, [edges]);

  const exportLayoutJson = useMemo(() => {
    return JSON.stringify(exportLayout(graphLayout, slots, edges, defaultCenterSlotId), null, 2);
  }, [defaultCenterSlotId, edges, slots]);

  const labelPresentationById = useMemo(() => {
    const presentation = new Map<string, LabelPresentation>();
    const zoomRange = Math.max(0.0001, zoomLimits.maxScale - zoomLimits.minScale);
    const zoomProgress = clampScalar((viewport.scale - zoomLimits.minScale) / zoomRange, 0, 1);
    const lowZoom = zoomProgress <= LABEL_LOW_ZOOM_PROGRESS_THRESHOLD;
    const mediumZoom = zoomProgress >= LABEL_MEDIUM_ZOOM_PROGRESS_THRESHOLD;
    const fullTextZoom = zoomProgress >= LABEL_FULL_TEXT_PROGRESS_THRESHOLD;
    const nearMaxZoom = zoomLimits.maxScale > 0
      && (viewport.scale / zoomLimits.maxScale) >= 0.9;
    const slotScreenById = new Map<string, { x: number; y: number; radius: number }>();

    for (const slot of slots) {
      const radius = clamp(SLOT_RADIUS * viewport.scale, 8, 30);
      slotScreenById.set(slot.id, {
        x: worldToScreenX(slot.x, viewport),
        y: worldToScreenY(slot.y, viewport),
        radius,
      });
    }

    for (const slot of slots) {
      const isImportantLowZoom = importantLowZoomSlotIds.has(slot.id);
      const isInteractionTarget = endpointSlotIds.has(slot.id)
        || highlightedSlotIds.has(slot.id)
        || expandedLabelSlotId === slot.id;
      const visibleAliasCount = slot.node.aliases.reduce((count, alias) => {
        return alias.label.trim().length > 0 ? (count + 1) : count;
      }, 0);
      const junctionClusterFullTextByZoom = (
        slot.node.type === 'junction'
        && visibleAliasCount >= 3
        && zoomProgress >= LABEL_JUNCTION_CLUSTER_FULL_TEXT_PROGRESS_THRESHOLD
      );
      const fullTextByZoom = fullTextZoom && slot.node.type !== 'junction';
      const canPromoteByMedium = (
        mediumZoom
        && isImportantLowZoom
        && slot.node.type !== 'junction'
      );
      let emphasized = (
        isInteractionTarget
        || nearMaxZoom
        || fullTextByZoom
        || junctionClusterFullTextByZoom
        || canPromoteByMedium
      );

      if (
        !emphasized
        && !lowZoom
        && !editLayoutMode
        && slot.node.type !== 'intersection'
        && slot.node.type !== 'junction'
      ) {
        const expandedLabel = getLabelPresentation(slot, editLayoutMode, true, false);
        const slotScreen = slotScreenById.get(slot.id);

        if (expandedLabel && slotScreen && viewportSize.width > 0 && viewportSize.height > 0) {
          const maxLabelLeft = Math.max(
            LABEL_VIEWPORT_MARGIN,
            viewportSize.width - expandedLabel.width - LABEL_VIEWPORT_MARGIN,
          );
          const maxLabelTop = Math.max(
            LABEL_VIEWPORT_MARGIN,
            viewportSize.height - expandedLabel.height - LABEL_VIEWPORT_MARGIN,
          );

          const preferredTopBelow = slotScreen.y + slotScreen.radius + 7;
          const preferredTopAbove = slotScreen.y - slotScreen.radius - expandedLabel.height - 5;
          const belowTop = clamp(preferredTopBelow, LABEL_VIEWPORT_MARGIN, maxLabelTop);
          const aboveTop = clamp(preferredTopAbove, LABEL_VIEWPORT_MARGIN, maxLabelTop);
          const useAboveFirst = preferredTopBelow + expandedLabel.height > maxLabelTop;
          const top = useAboveFirst ? aboveTop : belowTop;
          const left = clamp(
            slotScreen.x - expandedLabel.width / 2,
            LABEL_VIEWPORT_MARGIN,
            maxLabelLeft,
          );
          const right = left + expandedLabel.width;
          const bottom = top + expandedLabel.height;
          const blockPadding = slotScreen.radius + 4;

          const blockedByNeighbor = slots.some((other) => {
            if (other.id === slot.id) {
              return false;
            }

            const otherScreen = slotScreenById.get(other.id);
            if (!otherScreen) {
              return false;
            }

            return (
              otherScreen.x >= left - blockPadding
              && otherScreen.x <= right + blockPadding
              && otherScreen.y >= top - blockPadding
              && otherScreen.y <= bottom + blockPadding
            );
          });

          if (!blockedByNeighbor) {
            emphasized = true;
          }
        }
      }

      const label = getLabelPresentation(slot, editLayoutMode, emphasized, nearMaxZoom || fullTextByZoom);
      if (label) {
        presentation.set(slot.id, label);
      }
    }

    return presentation;
  }, [
    editLayoutMode,
    endpointSlotIds,
    expandedLabelSlotId,
    highlightedSlotIds,
    importantLowZoomSlotIds,
    slots,
    viewport,
    viewportSize.height,
    viewportSize.width,
    zoomLimits.minScale,
    zoomLimits.maxScale,
  ]);

  const labelLayoutById = useMemo(() => {
    const layouts = new Map<string, LabelLayout>();
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return layouts;
    }

    const zoomRange = Math.max(0.0001, zoomLimits.maxScale - zoomLimits.minScale);
    const zoomProgress = clampScalar((viewport.scale - zoomLimits.minScale) / zoomRange, 0, 1);
    const lowZoom = zoomProgress <= LABEL_LOW_ZOOM_PROGRESS_THRESHOLD;
    const fullTextZoom = zoomProgress >= LABEL_FULL_TEXT_PROGRESS_THRESHOLD;
    const candidates: LabelCandidate[] = [];
    const occludesHighlightedRoute = (
      left: number,
      top: number,
      right: number,
      bottom: number,
      routeAnchored: boolean,
    ): boolean => {
      if (highlightedRouteScreenSegments.length === 0) {
        return false;
      }

      const buffer = routeAnchored
        ? LABEL_ROUTE_ANCHORED_OCCLUSION_BUFFER
        : LABEL_ROUTE_OCCLUSION_BUFFER;

      const bufferedLeft = left - buffer;
      const bufferedTop = top - buffer;
      const bufferedRight = right + buffer;
      const bufferedBottom = bottom + buffer;

      return highlightedRouteScreenSegments.some((segment) => {
        return segmentIntersectsRect(
          segment,
          bufferedLeft,
          bufferedTop,
          bufferedRight,
          bufferedBottom,
        );
      });
    };

    for (const slot of slots) {
      if (expandedLabelSlotId === slot.id) {
        continue;
      }
      const presentation = labelPresentationById.get(slot.id);
      if (!presentation) {
        continue;
      }

      const isEndpoint = endpointSlotIds.has(slot.id);
      const isHighlighted = highlightedSlotIds.has(slot.id);
      const isImportantLowZoom = importantLowZoomSlotIds.has(slot.id);
      if (!editLayoutMode && lowZoom && !isImportantLowZoom) {
        continue;
      }

      const slotScreenX = worldToScreenX(slot.x, viewport);
      const slotScreenY = worldToScreenY(slot.y, viewport);
      const slotRadius = clamp(SLOT_RADIUS * viewport.scale, 8, 30);

      const slotAnchorVisible = (
        slotScreenX >= -slotRadius
        && slotScreenX <= viewportSize.width + slotRadius
        && slotScreenY >= -slotRadius
        && slotScreenY <= viewportSize.height + slotRadius
      );

      if (!slotAnchorVisible) {
        continue;
      }

      const minLabelLeft = LABEL_VIEWPORT_MARGIN;
      const maxLabelLeft = Math.max(
        LABEL_VIEWPORT_MARGIN,
        viewportSize.width - presentation.width - LABEL_VIEWPORT_MARGIN,
      );
      const minLabelTop = LABEL_VIEWPORT_MARGIN;
      const maxLabelTop = Math.max(
        LABEL_VIEWPORT_MARGIN,
        viewportSize.height - presentation.height - LABEL_VIEWPORT_MARGIN,
      );
      const preferredTopBelow = slotScreenY + slotRadius + 7;
      const preferredTopAbove = slotScreenY - slotRadius - presentation.height - 5;
      const belowTop = clamp(preferredTopBelow, minLabelTop, maxLabelTop);
      const aboveTop = clamp(preferredTopAbove, minLabelTop, maxLabelTop);
      const useAboveFirst = preferredTopBelow + presentation.height > maxLabelTop;
      let top = useAboveFirst ? aboveTop : belowTop;
      let alternateTop: number | null = useAboveFirst ? belowTop : aboveTop;
      const anchoredLeft = slotScreenX - presentation.width / 2;
      let left = clamp(anchoredLeft, minLabelLeft, maxLabelLeft);
      const right = left + presentation.width;
      const bottom = top + presentation.height;
      const alternateBottom = alternateTop === null ? null : (alternateTop + presentation.height);
      const centerDriftX = Math.abs((left + presentation.width / 2) - slotScreenX);
      const preferredTop = useAboveFirst ? preferredTopAbove : preferredTopBelow;
      const topDrift = Math.abs(top - preferredTop);
      const maxCenterDriftX = Math.max(24, slotRadius + 20);
      const maxTopDrift = presentation.height + slotRadius + (slot.node.type === 'junction' ? 28 : 10);
      if (centerDriftX > maxCenterDriftX || topDrift > maxTopDrift) {
        continue;
      }

      let priority = 0;
      if (isEndpoint) {
        priority += 100;
      }
      if (isHighlighted) {
        priority += 60;
      }
      if (slot.node.type === 'building') {
        priority += 20;
      } else if (slot.node.type === 'junction') {
        priority += 22;
        if (!fullTextZoom) {
          priority += 18;
        }
        if (isImportantLowZoom && !fullTextZoom) {
          priority += 24;
        }
      }
      if (slot.node.exitOnly) {
        priority += 5;
      }
      if (isImportantLowZoom) {
        priority += 26;
      }

      const routeAnchored = isEndpoint || isHighlighted;
      const candidateOccludesHighlightedRoute = occludesHighlightedRoute(
        left,
        top,
        right,
        bottom,
        routeAnchored,
      );
      if (candidateOccludesHighlightedRoute && !routeAnchored) {
        priority -= 72;
      }

      candidates.push({
        id: slot.id,
        left,
        top,
        right,
        bottom,
        alternateTop: alternateTop !== null && Math.abs(alternateTop - top) > 1 ? alternateTop : null,
        alternateBottom: alternateTop !== null && alternateBottom !== null && Math.abs(alternateTop - top) > 1
          ? alternateBottom
          : null,
        priority,
        pinned: false,
        routeAnchored,
        occludesHighlightedRoute: candidateOccludesHighlightedRoute,
      });
    }

    if (editLayoutMode) {
      for (const candidate of candidates) {
        layouts.set(candidate.id, {
          left: candidate.left,
          top: candidate.top,
          occludesHighlightedRoute: candidate.occludesHighlightedRoute,
        });
      }
      return layouts;
    }

    candidates.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      const aRoutePenalty = a.occludesHighlightedRoute && !a.routeAnchored ? 1 : 0;
      const bRoutePenalty = b.occludesHighlightedRoute && !b.routeAnchored ? 1 : 0;
      if (aRoutePenalty !== bRoutePenalty) {
        return aRoutePenalty - bRoutePenalty;
      }
      if (a.top !== b.top) {
        return a.top - b.top;
      }
      return a.left - b.left;
    });

    const accepted: LabelCandidate[] = [];
    const hasPinnedExpanded = candidates.some((candidate) => candidate.pinned);
    const collidesWithAccepted = (
      candidate: LabelCandidate,
      ignorePinnedExpanded: boolean,
    ): boolean => {
      return accepted.some((existing) => {
        if (ignorePinnedExpanded && hasPinnedExpanded && existing.pinned) {
          return false;
        }
        return labelsOverlap(candidate, existing);
      });
    };

    for (const candidate of candidates) {
      if (candidate.pinned) {
        accepted.push(candidate);
        layouts.set(candidate.id, {
          left: candidate.left,
          top: candidate.top,
          occludesHighlightedRoute: candidate.occludesHighlightedRoute,
        });
        continue;
      }

      let placed: LabelCandidate | null = candidate;
      const collidesPrimary = collidesWithAccepted(candidate, true);
      const primaryOccludesHighlightedRoute = candidate.occludesHighlightedRoute && !candidate.routeAnchored;

      if (collidesPrimary || primaryOccludesHighlightedRoute) {
        if (candidate.alternateTop === null || candidate.alternateBottom === null) {
          placed = null;
        } else {
          const alternateCandidate: LabelCandidate = {
            ...candidate,
            top: candidate.alternateTop,
            bottom: candidate.alternateBottom,
            alternateTop: null,
            alternateBottom: null,
            occludesHighlightedRoute: occludesHighlightedRoute(
              candidate.left,
              candidate.alternateTop,
              candidate.right,
              candidate.alternateBottom,
              candidate.routeAnchored,
            ),
          };
          const collidesAlternate = collidesWithAccepted(alternateCandidate, true);
          const alternateOccludesHighlightedRoute = (
            alternateCandidate.occludesHighlightedRoute
            && !alternateCandidate.routeAnchored
          );
          placed = (collidesAlternate || alternateOccludesHighlightedRoute) ? null : alternateCandidate;
        }
      }

      if (!placed) {
        continue;
      }

      accepted.push(placed);
      layouts.set(placed.id, {
        left: placed.left,
        top: placed.top,
        occludesHighlightedRoute: placed.occludesHighlightedRoute,
      });
    }

    return layouts;
  }, [
    editLayoutMode,
    expandedLabelSlotId,
    endpointSlotIds,
    highlightedSlotIds,
    importantLowZoomSlotIds,
    highlightedRouteScreenSegments,
    labelPresentationById,
    slots,
    viewport,
    viewportSize.height,
    viewportSize.width,
    zoomLimits.maxScale,
    zoomLimits.minScale,
  ]);

  const suppressedByExpandedLabelIds = useMemo(() => {
    const suppressed = new Set<string>();
    if (!expandedLabelSlotId || !expandedLabelAnchor) {
      return suppressed;
    }

    const expandedSlot = slotById.get(expandedLabelSlotId);
    if (!expandedSlot) {
      return suppressed;
    }

    const expandedPresentation = getLabelPresentation(expandedSlot, editLayoutMode, true, true);
    if (!expandedPresentation) {
      return suppressed;
    }

    const expandedLeft = expandedLabelAnchor.left;
    const expandedTop = expandedLabelAnchor.top;
    const expandedRight = expandedLeft + expandedPresentation.width;
    const expandedBottom = expandedTop + expandedPresentation.height;

    for (const slot of slots) {
      if (slot.id === expandedLabelSlotId) {
        continue;
      }

      const layout = labelLayoutById.get(slot.id);
      const presentation = labelPresentationById.get(slot.id);
      if (!layout || !presentation) {
        continue;
      }

      const left = layout.left;
      const top = layout.top;
      const right = left + presentation.width;
      const bottom = top + presentation.height;
      if (rectanglesOverlap(expandedLeft, expandedTop, expandedRight, expandedBottom, left, top, right, bottom, 3, 2)) {
        suppressed.add(slot.id);
      }
    }

    return suppressed;
  }, [
    editLayoutMode,
    expandedLabelAnchor,
    expandedLabelSlotId,
    labelLayoutById,
    labelPresentationById,
    slotById,
    slots,
  ]);

  useEffect(() => {
    if (viewportSize.width > 0 && viewportSize.height > 0) {
      return;
    }

    if (windowSize.width <= 0 || windowSize.height <= 0) {
      return;
    }

    setViewportSize({
      width: windowSize.width,
      height: windowSize.height,
    });
  }, [viewportSize.height, viewportSize.width, windowSize.height, windowSize.width]);

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

  const getPreferredFocusScale = (): number => {
    const preferred = Math.max(zoomLimits.minScale * 2.8, 0.72);
    return clampScalar(preferred, zoomLimits.minScale, zoomLimits.maxScale);
  };

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || slots.length === 0 || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    const startScale = getPreferredFocusScale();
    setViewport(() => {
      const slot = slotById.get(defaultCenterSlotId) ?? slots[0];
      const centered: Viewport = {
        scale: startScale,
        tx: viewportSize.width / 2 - slot.x * startScale,
        ty: viewportSize.height / 2 - slot.y * startScale,
      };
      return clampViewport(centered, bounds, viewportSize);
    });
  }, [bounds, defaultCenterSlotId, slots, slotById, viewportSize, zoomLimits.maxScale, zoomLimits.minScale]);

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
    if (!EDIT_LAYOUT_ENABLED && editLayoutMode) {
      setEditLayoutMode(false);
      return;
    }

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
      if (logoHintTimerRef.current) {
        clearTimeout(logoHintTimerRef.current);
      }
      if (focusHintTimerRef.current) {
        clearTimeout(focusHintTimerRef.current);
      }
      if (expandedLabelTimerRef.current) {
        clearTimeout(expandedLabelTimerRef.current);
      }
      if (holdFocusTimerRef.current) {
        clearTimeout(holdFocusTimerRef.current);
      }
      if (labelHoldTimerRef.current) {
        clearTimeout(labelHoldTimerRef.current);
      }
      if (endpointHoldTimerRef.current) {
        clearTimeout(endpointHoldTimerRef.current);
      }
      if (deletePromptTimerRef.current) {
        clearTimeout(deletePromptTimerRef.current);
      }
      if (toolHoldTimerRef.current) {
        clearTimeout(toolHoldTimerRef.current);
      }
      if (routeInfoTimerRef.current) {
        clearTimeout(routeInfoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    introAnim.setValue(0);
    Animated.timing(introAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [introAnim]);

  useEffect(() => {
    Animated.timing(toolsDockAnim, {
      toValue: toolsDockOpen ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [toolsDockAnim, toolsDockOpen]);

  useEffect(() => {
    if (!toolsDockOpen) {
      cancelToolHold();
    }
  }, [toolsDockOpen]);

  useEffect(() => {
    if (!routeInfoOpen || routeInfoPinned) {
      clearRouteInfoAutoHideTimer();
      return;
    }

    clearRouteInfoAutoHideTimer();
    routeInfoTimerRef.current = setTimeout(() => {
      setRouteInfoOpen(false);
      routeInfoTimerRef.current = null;
    }, ROUTE_INFO_AUTO_HIDE_MS);
  }, [routeInfoOpen, routeInfoPinned]);

  useEffect(() => {
    if (!routeInfoOpen && routeInfoPinned) {
      setRouteInfoPinned(false);
    }
  }, [routeInfoOpen, routeInfoPinned]);

  useEffect(() => {
    if (routes.length === 0) {
      routeGlow.setValue(0);
      return;
    }

    routeGlow.setValue(0);
    Animated.timing(routeGlow, {
      toValue: 1,
      duration: 680,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [routeGlow, routeSignature]);

  useEffect(() => {
    if (draggingEndpoint && toolsDockOpen && !toolsPinned) {
      setToolsDockOpen(false);
    }
  }, [draggingEndpoint, toolsDockOpen, toolsPinned]);

  const triggerBlockedFeedback = (message: string): void => {
    setBlockedMessage(message);
    triggerHaptic('warning');

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

    hideDeletePrompt();
    const slot = slotById.get(slotId);

    const occupied = endpointsRef.current.some((endpoint) => endpoint.slotId === slotId);
    if (occupied) {
      return;
    }

    if (endpointsRef.current.length === 0) {
      triggerTapPulse(slotId);
      triggerHaptic('light');
      setEndpoints([{ id: 'start', slotId }]);
      return;
    }

    if (endpointsRef.current.length === 1) {
      const existing = endpointsRef.current[0];
      const nextEndpointId = existing.id === 'start' ? 'end' : 'start';
      if (slot?.node.exitOnly && nextEndpointId === 'end') {
        triggerBlockedFeedback('Exit-only slots can only be a start endpoint.');
        return;
      }
      triggerTapPulse(slotId);
      triggerHaptic('light');
      setEndpoints(endpointOrder([
        { id: existing.id === 'end' ? 'end' : 'start', slotId: existing.slotId },
        { id: nextEndpointId, slotId },
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

    const targetSlotId = drag.targetSlotId;

    if (!targetSlotId) {
      if (drag.endpointId === 'end') {
        const snapRadiusWorld = SNAP_RADIUS_PX / viewportRef.current.scale;
        const slotHit = getSlotAtWorldPosition(drag.worldX, drag.worldY, snapRadiusWorld);
        if (slotHit?.slot.node.exitOnly) {
          triggerBlockedFeedback('Exit-only slots can only be a start endpoint.');
        }
      }
      setDraggingEndpoint(null);
      draggingEndpointRef.current = null;
      return;
    }

    const targetSlot = slotById.get(targetSlotId);
    if (drag.endpointId === 'end' && targetSlot?.node.exitOnly) {
      triggerBlockedFeedback('Exit-only slots can only be a start endpoint.');
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
    const droppedSlot = slotById.get(targetSlotId);
    if (!editLayoutRef.current && droppedSlot && hasUsableLabel(droppedSlot)) {
      showExpandedLabel(targetSlotId);
    }
    triggerHaptic('light');
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
    clearExpandedLabel();
    clearLabelHoldTimer();
    clearEndpointHoldTimer();
    hideDeletePrompt();

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
        interactionRef.current = {
          kind: 'endpoint-drag',
          endpointId: endpoint.id,
          originSlotId: endpoint.slotId,
          startX: touch.x,
          startY: touch.y,
          moved: false,
        };

        endpointHoldTimerRef.current = setTimeout(() => {
          const currentInteraction = interactionRef.current;
          if (
            currentInteraction.kind === 'endpoint-drag'
            && currentInteraction.endpointId === endpoint.id
            && !currentInteraction.moved
            && !draggingEndpointRef.current
          ) {
            triggerHaptic('warning');
            showDeletePromptForEndpoint(endpoint.id);
          }
          endpointHoldTimerRef.current = null;
        }, HOLD_TO_DELETE_MS);
        return;
      }
    }

    if (EDIT_LAYOUT_ENABLED && editLayoutRef.current) {
      const slotHit = getSlotAtWorldPosition(worldX, worldY, dragRadiusWorld);
      if (slotHit) {
        interactionRef.current = {
          kind: 'slot-drag',
          slotId: slotHit.slot.id,
        };
        return;
      }
    }

    const edgeHitIndex = EDIT_LAYOUT_ENABLED && editLayoutRef.current
      ? getEdgeHitAtWorldPosition(worldX, worldY, TAP_RADIUS_PX / currentViewport.scale)
      : null;
    const tapHit = getSlotAtWorldPosition(worldX, worldY, TAP_RADIUS_PX / currentViewport.scale);
    interactionRef.current = {
      kind: 'pan',
      startX: touch.x,
      startY: touch.y,
      startedAt: Date.now(),
      startTx: currentViewport.tx,
      startTy: currentViewport.ty,
      moved: false,
      slotTapCandidateId: tapHit?.slot.id ?? null,
      edgeTapCandidateIndex: edgeHitIndex,
    };

    if (!editLayoutRef.current && tapHit?.slot.id) {
      const slotId = tapHit.slot.id;
      labelHoldTimerRef.current = setTimeout(() => {
        const currentInteraction = interactionRef.current;
        if (
          currentInteraction.kind === 'pan'
          && !currentInteraction.moved
          && currentInteraction.slotTapCandidateId === slotId
          && !editLayoutRef.current
        ) {
          showExpandedLabel(slotId);
          interactionRef.current = { kind: 'idle' };
        }
        labelHoldTimerRef.current = null;
      }, LABEL_LONG_PRESS_MS);
    }
  };

  const onResponderMove = (event: GestureResponderEvent): void => {
    const touches = getInteractionPoints(event);
    const currentInteraction = interactionRef.current;

    if (touches.length >= 2) {
      clearLabelHoldTimer();
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
      const dx = touch.x - currentInteraction.startX;
      const dy = touch.y - currentInteraction.startY;
      const moved = currentInteraction.moved || Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD;

      if (moved !== currentInteraction.moved) {
        interactionRef.current = {
          ...currentInteraction,
          moved,
        };
      }

      if (!moved) {
        return;
      }

      clearEndpointHoldTimer();
      hideDeletePrompt();

      const currentViewport = viewportRef.current;
      const worldX = screenToWorldX(touch.x, currentViewport);
      const worldY = screenToWorldY(touch.y, currentViewport);
      const snapRadiusWorld = SNAP_RADIUS_PX / currentViewport.scale;
      const slotHit = getSlotAtWorldPosition(worldX, worldY, snapRadiusWorld);
      const targetSlotId = slotHit
        && !(currentInteraction.endpointId === 'end' && slotHit.slot.node.exitOnly)
        ? slotHit.slot.id
        : null;

      if (!draggingEndpointRef.current) {
        const originSlot = slotById.get(currentInteraction.originSlotId);
        if (originSlot) {
          const initialDrag: DraggingEndpointState = {
            endpointId: currentInteraction.endpointId,
            worldX: originSlot.x,
            worldY: originSlot.y,
            targetSlotId: currentInteraction.originSlotId,
          };
          setDraggingEndpoint(initialDrag);
          draggingEndpointRef.current = initialDrag;
          triggerHaptic('light');
        }
      }

      const nextDrag: DraggingEndpointState = {
        endpointId: currentInteraction.endpointId,
        worldX,
        worldY,
        targetSlotId,
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

      if (moved && !currentInteraction.moved) {
        clearLabelHoldTimer();
      }

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
        startedAt: Date.now(),
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
    clearLabelHoldTimer();

    if (currentInteraction.kind === 'endpoint-drag') {
      clearEndpointHoldTimer();
      if (draggingEndpointRef.current) {
        finalizeEndpointDrop();
      } else if (!currentInteraction.moved && !editLayoutRef.current && !deletePrompt) {
        showExpandedLabel(currentInteraction.originSlotId);
      }
    }

    if (currentInteraction.kind === 'pan' && !currentInteraction.moved) {
      const isLongPress = Date.now() - currentInteraction.startedAt >= LABEL_LONG_PRESS_MS;
      if (!editLayoutRef.current && currentInteraction.slotTapCandidateId && isLongPress) {
        showExpandedLabel(currentInteraction.slotTapCandidateId);
        interactionRef.current = { kind: 'idle' };
        return;
      }

      triggerScreenTapPulse(currentInteraction.startX, currentInteraction.startY);
      if (editLayoutRef.current && currentInteraction.edgeTapCandidateIndex !== null) {
        setEdgeEditorIndex(currentInteraction.edgeTapCandidateIndex);
      } else if (currentInteraction.slotTapCandidateId) {
        handleSlotTap(currentInteraction.slotTapCandidateId);
      }
    }

    interactionRef.current = { kind: 'idle' };
  };

  const onResponderTerminate = (): void => {
    clearLabelHoldTimer();
    clearEndpointHoldTimer();
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

  const swapEndpoints = (): void => {
    setEndpoints((previous) => {
      if (previous.length !== 2) {
        return previous;
      }

      const start = previous.find((endpoint) => endpoint.id === 'start');
      const end = previous.find((endpoint) => endpoint.id === 'end');
      if (!start || !end) {
        return previous;
      }

      const startSlot = slotById.get(start.slotId);
      const endSlot = slotById.get(end.slotId);
      if (startSlot?.node.exitOnly || endSlot?.node.exitOnly) {
        triggerBlockedFeedback('Cannot swap when an exit-only slot is set as start.');
        return previous;
      }

      triggerHaptic('light');
      return [
        { id: 'start', slotId: end.slotId },
        { id: 'end', slotId: start.slotId },
      ];
    });
  };

  const clearEndpoints = (): void => {
    setEndpoints([]);
    setDraggingEndpoint(null);
    draggingEndpointRef.current = null;
    hideDeletePrompt();
    triggerHaptic('success');
  };

  const deleteEndpointById = (endpointId: Endpoint['id']): void => {
    setEndpoints((previous) => previous.filter((endpoint) => endpoint.id !== endpointId));
    hideDeletePrompt();
    triggerHaptic('success');
  };

  const runToolAction = (action: () => void): void => {
    action();
    if (!toolsPinned) {
      setToolsDockOpen(false);
    }
  };

  const startToolHold = (actionId: HoldToolAction, action: () => void): void => {
    if (actionId === 'swap' && endpointsRef.current.length !== 2) {
      return;
    }

    if (activeToolHoldActionRef.current && activeToolHoldActionRef.current !== actionId) {
      cancelToolHold();
    }

    const anim = getToolHoldAnim(actionId);
    clearToolHoldTimer();
    anim.stopAnimation();
    anim.setValue(0);

    activeToolHoldActionRef.current = actionId;
    setActiveToolHoldAction(actionId);

    Animated.timing(anim, {
      toValue: 1,
      duration: TOOL_ACTION_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    toolHoldTimerRef.current = setTimeout(() => {
      if (activeToolHoldActionRef.current !== actionId) {
        return;
      }

      activeToolHoldActionRef.current = null;
      setActiveToolHoldAction(null);
      clearToolHoldTimer();
      runToolAction(action);

      anim.stopAnimation();
      Animated.timing(anim, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    }, TOOL_ACTION_HOLD_MS);
  };

  const releaseToolHold = (actionId: HoldToolAction): void => {
    if (activeToolHoldActionRef.current !== actionId) {
      return;
    }
    cancelToolHold();
  };

  const endpointIndicators = useMemo<EndpointIndicator[]>(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return [];
    }

    const margin = ENDPOINT_INDICATOR_MARGIN;
    const indicators: EndpointIndicator[] = [];
    const ordered = endpointOrder(endpoints);
    const visibleEndpointAnchors: Array<{ x: number; y: number }> = [];
    const endpointRadius = clamp(ENDPOINT_RADIUS * viewport.scale, 11, 40);
    const triggerOffset = Math.max(8, endpointRadius * ENDPOINT_INDICATOR_TRIGGER_RATIO);
    const isFarOffscreen = (screenX: number, screenY: number): boolean => {
      return (
        screenX < -triggerOffset
        || screenX > viewportSize.width + triggerOffset
        || screenY < -triggerOffset
        || screenY > viewportSize.height + triggerOffset
      );
    };

    for (const endpoint of ordered) {
      const slot = slotById.get(endpoint.slotId);
      if (!slot) {
        continue;
      }

      const sx = worldToScreenX(slot.x, viewport);
      const sy = worldToScreenY(slot.y, viewport);
      const offscreen = isFarOffscreen(sx, sy);

      if (!offscreen) {
        visibleEndpointAnchors.push({ x: sx, y: sy });
      }
    }

    for (const endpoint of ordered) {
      const slot = slotById.get(endpoint.slotId);
      if (!slot) {
        continue;
      }

      const sx = worldToScreenX(slot.x, viewport);
      const sy = worldToScreenY(slot.y, viewport);
      const offscreen = isFarOffscreen(sx, sy);

      if (!offscreen) {
        continue;
      }

      const x = clamp(sx, margin, viewportSize.width - margin);
      const y = clamp(sy, margin, viewportSize.height - margin);
      const edgeClampedX = x <= margin + 0.5 || x >= viewportSize.width - margin - 0.5;
      const edgeClampedY = y <= margin + 0.5 || y >= viewportSize.height - margin - 0.5;
      const adjustAlongY = edgeClampedX || (!edgeClampedX && edgeClampedY);

      const collides = (candidateX: number, candidateY: number): boolean => {
        const overlapsVisibleEndpoint = visibleEndpointAnchors.some((anchor) => {
          return distance(candidateX, candidateY, anchor.x, anchor.y) < ENDPOINT_INDICATOR_CLEARANCE;
        });
        if (overlapsVisibleEndpoint) {
          return true;
        }

        return indicators.some((existing) => {
          return distance(candidateX, candidateY, existing.x, existing.y) < ENDPOINT_INDICATOR_CLEARANCE;
        });
      };

      let resolvedX = x;
      let resolvedY = y;
      if (collides(resolvedX, resolvedY)) {
        const span = adjustAlongY
          ? Math.max(0, viewportSize.height - margin * 2)
          : Math.max(0, viewportSize.width - margin * 2);
        const maxSteps = Math.max(1, Math.ceil(span / ENDPOINT_INDICATOR_STEP));
        let found = false;

        for (let stepIndex = 1; stepIndex <= maxSteps && !found; stepIndex += 1) {
          for (const direction of [-1, 1]) {
            const offset = ENDPOINT_INDICATOR_STEP * stepIndex * direction;
            const candidateX = adjustAlongY
              ? x
              : clamp(x + offset, margin, viewportSize.width - margin);
            const candidateY = adjustAlongY
              ? clamp(y + offset, margin, viewportSize.height - margin)
              : y;

            if (!collides(candidateX, candidateY)) {
              resolvedX = candidateX;
              resolvedY = candidateY;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          continue;
        }
      }

      const angle = Math.atan2(sy - resolvedY, sx - resolvedX);

      indicators.push({
        id: endpoint.id,
        slotId: endpoint.slotId,
        x: resolvedX,
        y: resolvedY,
        angle,
      });
    }

    return indicators;
  }, [endpoints, slotById, viewport, viewportSize.height, viewportSize.width]);

  const dropPreviewSlotId = draggingEndpoint?.targetSlotId;
  const swapHoldProgressWidth = swapHoldAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TOOLS_HOLD_PROGRESS_WIDTH],
  });
  const clearHoldProgressWidth = clearHoldAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TOOLS_HOLD_PROGRESS_WIDTH],
  });
  const swapHoldCenterInset = swapHoldAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [TOOLS_CENTER_HOLD_WRAP_SIZE / 2, 0],
  });
  const clearHoldCenterWidth = clearHoldAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TOOLS_CENTER_HOLD_WRAP_SIZE],
  });
  const toolsHoldHintText = activeToolHoldAction === 'swap'
    ? 'Hold to swap'
    : activeToolHoldAction === 'clear'
      ? 'Hold to clear'
      : 'Hold to confirm';
  const toolsDockTranslateX = toolsDockAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const introTranslateY = introAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const routeGlowOpacity = routeGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });
  const topControlsTop = 10 + topInset;
  const topControlsHeight = 50;
  const blockedToastTop = topControlsTop + topControlsHeight + 8;
  const slotTapPulseOpacity = slotTapPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0],
  });
  const slotTapPulseScale = slotTapPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 2.5],
  });
  const screenTapPulseOpacity = screenTapPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.36, 0],
  });
  const screenTapPulseScale = screenTapPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 2],
  });
  const logoHintOpacity = logoHintAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const logoHintTranslateX = logoHintAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 0],
  });
  const focusHintOpacity = focusHintAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const focusHintTranslateX = focusHintAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  return (
    <Animated.View
      style={[
        styles.screen,
        {
          opacity: introAnim,
          transform: [{ translateY: introTranslateY }],
        },
      ]}
    >
      <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" translucent={false} backgroundColor="#121a26" />

      <View
        ref={canvasRef}
        style={styles.canvas}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setViewportSize({ width, height });
        }}
      >
        <View style={styles.canvasBackdrop} />

        <View
          style={styles.touchLayer}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onResponderGrant}
          onResponderMove={onResponderMove}
          onResponderRelease={onResponderRelease}
          onResponderTerminate={onResponderTerminate}
          onResponderTerminationRequest={() => false}
        >
          <View pointerEvents="none" style={styles.sceneLayer}>
            {editLayoutMode ? (
              <>
                {gridModel.xValues.map((x) => (
                  <View
                    key={`grid-x-${x}`}
                    style={[
                      styles.gridLineVertical,
                      {
                        left: worldToScreenX(x, viewport),
                        top: worldToScreenY(gridModel.minY, viewport),
                        height: Math.max(1, (gridModel.maxY - gridModel.minY) * viewport.scale),
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
                        top: worldToScreenY(y, viewport),
                        left: worldToScreenX(gridModel.minX, viewport),
                        width: Math.max(1, (gridModel.maxX - gridModel.minX) * viewport.scale),
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
                            left: worldToScreenX(x, viewport) - 1.5,
                            top: worldToScreenY(y, viewport) - 1.5,
                          },
                        ]}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </>
            ) : null}

            {edges.map((edge, index) => {
              const key = edgeKey(edge.from, edge.to);
              const routeColor = routeEdgeColors.get(key);
              const isHighlighted = Boolean(routeColor);
              const revealIndex = primaryRouteEdgeIndex.get(key);
              const primaryFlow = primaryRouteEdgeFlow.get(key);
              const segments = getEdgeSegments(edge, slotById);

              return segments.map((segment, segmentIndex) => {
                const x1 = worldToScreenX(segment.x1, viewport);
                const y1 = worldToScreenY(segment.y1, viewport);
                const x2 = worldToScreenX(segment.x2, viewport);
                const y2 = worldToScreenY(segment.y2, viewport);
                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.sqrt(dx * dx + dy * dy);
                if (length <= 0.001) {
                  return null;
                }

                const angle = Math.atan2(dy, dx);
                const edgeColor = routeColor ?? (EDGE_TYPE_COLORS[edge.type] ?? '#4a627f');
                const isStairsEdge = edge.type === 'stairs';
                const isRampEdge = edge.type === 'ramp';
                const strokeHeight = isHighlighted ? 4 : 2;
                const trackHeight = isRampEdge ? strokeHeight + 3 : strokeHeight + 2;
                const trackStyle = {
                  left: (x1 + x2) / 2 - length / 2,
                  top: (y1 + y2) / 2 - trackHeight / 2,
                  width: length,
                  height: trackHeight,
                  transform: [{ rotate: `${angle}rad` }],
                };
                const strokeTop = (trackHeight - strokeHeight) / 2;
                const flowMatchesRenderDirection = primaryFlow
                  ? primaryFlow.from === edge.from && primaryFlow.to === edge.to
                  : true;
                const markerRotation = flowMatchesRenderDirection ? '0rad' : `${Math.PI}rad`;
                const markerOffsets = (isHighlighted && revealIndex !== undefined)
                  ? getDirectionMarkerOffsets(length)
                  : [];
                const stairStepOffsets = isStairsEdge ? getStairStepOffsets(length) : [];
                const showLevelChangeIcon = (
                  (isStairsEdge || isRampEdge)
                  && length >= LEVEL_CHANGE_ICON_MIN_LENGTH
                  && viewport.scale > zoomLimits.minScale * 1.04
                );
                const strokeStyle = {
                  top: strokeTop,
                  width: length,
                  height: strokeHeight,
                  backgroundColor: edgeColor,
                  opacity: isHighlighted ? 0.98 : 0.84,
                };

                if (isHighlighted) {
                  const revealOpacity = revealIndex !== undefined
                    ? routeReveal.interpolate({
                      inputRange: [revealIndex - 0.8, revealIndex + 1.4],
                      outputRange: [0.04, 1],
                      extrapolate: 'clamp',
                    })
                    : 1;

                  const highlightedOpacity = revealIndex !== undefined
                    ? Animated.multiply(revealOpacity, routeGlowOpacity)
                    : routeGlowOpacity;
                  const segmentFillProgress = revealIndex !== undefined
                    ? routeReveal.interpolate({
                      inputRange: [revealIndex, revealIndex + 1],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    })
                    : 1;
                  const fillWidth = revealIndex !== undefined
                    ? Animated.multiply(segmentFillProgress, length)
                    : length;

                  return (
                    <Animated.View
                      key={`${edge.from}-${edge.to}-${index}-${segmentIndex}`}
                      style={[
                        styles.edgeTrack,
                        trackStyle,
                        {
                          opacity: highlightedOpacity,
                        },
                      ]}
                    >
                      <View style={[styles.edgeStroke, strokeStyle]} />
                      <Animated.View
                        style={[
                          styles.edgeFlowFill,
                          {
                            top: strokeTop + Math.max(0, (strokeHeight - 0.2) / 2),
                            height: Math.max(1, strokeHeight - 0.3),
                            width: fillWidth,
                            left: flowMatchesRenderDirection ? 0 : undefined,
                            right: flowMatchesRenderDirection ? undefined : 0,
                          },
                        ]}
                      />
                      {isRampEdge ? (
                        <View
                          style={[
                            styles.edgeRampRail,
                            {
                              top: strokeTop + Math.max(2, strokeHeight - 1),
                              backgroundColor: edgeColor,
                              opacity: 0.95,
                            },
                          ]}
                        />
                      ) : null}
                      {isStairsEdge ? (
                        stairStepOffsets.map((offset, stepIndex) => (
                          <View
                            key={`stairs-step-${edge.from}-${edge.to}-${index}-${segmentIndex}-${stepIndex}`}
                            style={[
                              styles.edgeStairsStep,
                              {
                                left: offset,
                                top: strokeTop - 1,
                                opacity: 0.9,
                              },
                            ]}
                          />
                        ))
                      ) : null}
                      {markerOffsets.map((offset, markerIndex) => (
                        <View
                          key={`dir-${edge.from}-${edge.to}-${index}-${segmentIndex}-${markerIndex}`}
                          style={[
                            styles.routeDirectionMarkerWrap,
                            {
                              left: offset - 9,
                              top: strokeTop - 6,
                              transform: [{ rotate: markerRotation }],
                            },
                          ]}
                        >
                          <MaterialCommunityIcons name="chevron-right" size={13} color="#f5fbff" />
                        </View>
                      ))}
                      {showLevelChangeIcon ? (
                        <View
                          style={[
                            styles.levelChangeBadge,
                            {
                              left: length / 2 - 8,
                              top: strokeTop - 9,
                            },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={isStairsEdge ? 'stairs' : 'trending-up'}
                            size={10}
                            color="#f4f8ff"
                          />
                        </View>
                      ) : null}
                    </Animated.View>
                  );
                }

                return (
                  <View
                    key={`${edge.from}-${edge.to}-${index}-${segmentIndex}`}
                    style={[
                      styles.edgeTrack,
                      trackStyle,
                    ]}
                  >
                    <View
                      style={[
                        styles.edgeStroke,
                        strokeStyle,
                      ]}
                    />
                    {isRampEdge ? (
                      <View
                        style={[
                          styles.edgeRampRail,
                          {
                            top: strokeTop + 2,
                            backgroundColor: edgeColor,
                            opacity: 0.9,
                          },
                        ]}
                      />
                    ) : null}
                    {isStairsEdge ? (
                      stairStepOffsets.map((offset, stepIndex) => (
                        <View
                          key={`stairs-step-${edge.from}-${edge.to}-${index}-${segmentIndex}-${stepIndex}`}
                          style={[
                            styles.edgeStairsStep,
                            {
                              left: offset,
                              top: strokeTop - 1,
                              opacity: 0.74,
                            },
                          ]}
                        />
                      ))
                    ) : null}
                    {showLevelChangeIcon ? (
                      <View
                        style={[
                          styles.levelChangeBadge,
                          {
                            left: length / 2 - 8,
                            top: strokeTop - 9,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={isStairsEdge ? 'stairs' : 'trending-up'}
                          size={10}
                          color="#f4f8ff"
                        />
                      </View>
                    ) : null}
                  </View>
                );
              });
            })}

          {slots.map((slot) => {
            const highlighted = highlightedSlotIds.has(slot.id);
            const isDropTarget = dropPreviewSlotId === slot.id;
            const isExitOnly = slot.node.exitOnly;
            const isHoldFocused = holdFocusSlotId === slot.id;
            const isExpandedLabel = expandedLabelSlotId === slot.id;
            const slotScreenX = worldToScreenX(slot.x, viewport);
            const slotScreenY = worldToScreenY(slot.y, viewport);
            const slotRadius = clamp(SLOT_RADIUS * viewport.scale, 8, 30);
            const labelLayout = labelLayoutById.get(slot.id);
            const labelPresentation = labelPresentationById.get(slot.id);
            const expandedLabelPresentation = isExpandedLabel
              ? getLabelPresentation(slot, editLayoutMode, true, true)
              : null;
            const labelLeftLocal = labelLayout ? labelLayout.left - (slotScreenX - slotRadius) : 0;
            const labelTopLocal = labelLayout ? labelLayout.top - (slotScreenY - slotRadius) : 0;
            const labelRightLocal = labelLeftLocal + (labelPresentation?.width ?? 0);
            const labelBottomLocal = labelTopLocal + (labelPresentation?.height ?? 0);
            let expandedLabelLeftLocal = 0;
            let expandedLabelTopLocal = 0;
            let expandedLabelRightLocal = 0;
            let expandedLabelBottomLocal = 0;
            if (expandedLabelPresentation) {
              const maxExpandedLeft = Math.max(
                LABEL_VIEWPORT_MARGIN,
                viewportSize.width - expandedLabelPresentation.width - LABEL_VIEWPORT_MARGIN,
              );
              const maxExpandedTop = Math.max(
                LABEL_VIEWPORT_MARGIN,
                viewportSize.height - expandedLabelPresentation.height - LABEL_VIEWPORT_MARGIN,
              );
              const preferredTopBelow = slotScreenY + slotRadius + 7;
              const preferredTopAbove = slotScreenY - slotRadius - expandedLabelPresentation.height - 5;
              const belowTop = clamp(preferredTopBelow, LABEL_VIEWPORT_MARGIN, maxExpandedTop);
              const aboveTop = clamp(preferredTopAbove, LABEL_VIEWPORT_MARGIN, maxExpandedTop);
              const useAboveFirst = preferredTopBelow + expandedLabelPresentation.height > maxExpandedTop;
              const defaultExpandedTop = useAboveFirst ? aboveTop : belowTop;
              const defaultExpandedLeft = clamp(
                slotScreenX - expandedLabelPresentation.width / 2,
                LABEL_VIEWPORT_MARGIN,
                maxExpandedLeft,
              );

              const expandedTop = (expandedLabelAnchor && expandedLabelAnchor.slotId === slot.id)
                ? expandedLabelAnchor.top
                : defaultExpandedTop;
              const expandedLeft = (expandedLabelAnchor && expandedLabelAnchor.slotId === slot.id)
                ? expandedLabelAnchor.left
                : defaultExpandedLeft;

              expandedLabelLeftLocal = expandedLeft - (slotScreenX - slotRadius);
              expandedLabelTopLocal = expandedTop - (slotScreenY - slotRadius);
              expandedLabelRightLocal = expandedLabelLeftLocal + expandedLabelPresentation.width;
              expandedLabelBottomLocal = expandedLabelTopLocal + expandedLabelPresentation.height;
            }
            const slotCenterX = slotRadius;
            const slotCenterY = slotRadius;
            let connectorLength = 0;
            let connectorLeft = 0;
            let connectorTop = 0;
            let connectorAngle = 0;
            const activeLabelLeft = expandedLabelPresentation ? expandedLabelLeftLocal : labelLeftLocal;
            const activeLabelTop = expandedLabelPresentation ? expandedLabelTopLocal : labelTopLocal;
            const activeLabelRight = expandedLabelPresentation ? expandedLabelRightLocal : labelRightLocal;
            const activeLabelBottom = expandedLabelPresentation ? expandedLabelBottomLocal : labelBottomLocal;
            const hasActiveLabel = expandedLabelPresentation || (labelLayout && labelPresentation);
            if (isHoldFocused && hasActiveLabel) {
              const targetX = clamp(slotCenterX, activeLabelLeft, activeLabelRight);
              const targetY = slotCenterY < activeLabelTop
                ? activeLabelTop
                : slotCenterY > activeLabelBottom
                  ? activeLabelBottom
                  : clamp(slotCenterY, activeLabelTop, activeLabelBottom);
              const vx = targetX - slotCenterX;
              const vy = targetY - slotCenterY;
              const rawLength = Math.sqrt(vx * vx + vy * vy);
              if (rawLength > 2) {
                const outward = Math.max(0, slotRadius - 2);
                const startX = slotCenterX + (vx / rawLength) * outward;
                const startY = slotCenterY + (vy / rawLength) * outward;
                connectorLength = Math.max(0, rawLength - outward + 2);
                connectorLeft = startX;
                connectorTop = startY - 0.75;
                connectorAngle = Math.atan2(vy, vx);
              }
            }

            return (
              <View
                key={slot.id}
                style={[
                    styles.slotWrap,
                    {
                      left: slotScreenX - slotRadius,
                      top: slotScreenY - slotRadius,
                      width: slotRadius * 2,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.slot,
                      {
                        width: slotRadius * 2,
                        height: slotRadius * 2,
                        borderRadius: slotRadius,
                      },
                      { borderColor: NODE_TYPE_COLORS[slot.node.type] ?? '#7f8a9b' },
                      isExitOnly ? styles.slotExitOnly : null,
                      highlighted
                        ? [
                          styles.slotHighlighted,
                          {
                            borderColor: isExitOnly
                              ? '#ffbe70'
                              : (NODE_TYPE_COLORS[slot.node.type] ?? '#dceaff'),
                            shadowColor: isExitOnly
                              ? '#ffbe70'
                              : (NODE_TYPE_COLORS[slot.node.type] ?? '#dceaff'),
                          },
                        ]
                        : null,
                      isDropTarget ? styles.slotDropPreview : null,
                      isHoldFocused ? styles.slotHoldFocus : null,
                    ]}
                />
                {connectorLength > 2 ? (
                  <View
                    style={[
                      styles.slotLabelConnector,
                      {
                        left: connectorLeft,
                        top: connectorTop,
                        width: connectorLength,
                        transform: [{ rotate: `${connectorAngle}rad` }],
                      },
                    ]}
                  />
                ) : null}
                {labelLayout && labelPresentation && !isExpandedLabel && !suppressedByExpandedLabelIds.has(slot.id) ? (
                  <Text
                    numberOfLines={labelPresentation.lines}
                    ellipsizeMode="tail"
                    style={[
                      styles.slotLabel,
                      highlighted ? styles.slotLabelOnHighlightedRoute : null,
                      labelLayout.occludesHighlightedRoute ? styles.slotLabelRouteWindow : null,
                      isHoldFocused ? styles.slotLabelFocused : null,
                      {
                        width: labelPresentation.width,
                        minHeight: labelPresentation.height,
                        left: labelLeftLocal,
                        top: labelTopLocal,
                      },
                    ]}
                  >
                    {labelPresentation.text}
                  </Text>
                ) : null}
                {isExpandedLabel && expandedLabelPresentation ? (
                  <Text
                    ellipsizeMode="clip"
                    style={[
                      styles.slotLabel,
                      highlighted ? styles.slotLabelOnHighlightedRoute : null,
                      isHoldFocused ? styles.slotLabelFocused : null,
                      styles.slotLabelExpandedOverlay,
                      {
                        width: expandedLabelPresentation.width,
                        minHeight: expandedLabelPresentation.height,
                        left: expandedLabelLeftLocal,
                        top: expandedLabelTopLocal,
                      },
                    ]}
                  >
                    {expandedLabelPresentation.text}
                  </Text>
                ) : null}
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
              const endpointScreenX = worldToScreenX(x, viewport);
              const endpointScreenY = worldToScreenY(y, viewport);
              const endpointRadius = clamp(ENDPOINT_RADIUS * viewport.scale, 11, 40);

              return (
                <View
                  key={endpoint.id}
                  style={[
                    styles.endpointWrap,
                    {
                      left: endpointScreenX - endpointRadius,
                      top: endpointScreenY - endpointRadius,
                      width: endpointRadius * 2,
                      height: endpointRadius * 2,
                      opacity: drag ? 0.94 : 1,
                      transform: [{ scale: drag ? 1.07 : 1 }],
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.endpoint,
                      {
                        width: endpointRadius * 2,
                        height: endpointRadius * 2,
                        borderRadius: endpointRadius,
                      },
                      isStart ? styles.endpointStart : styles.endpointEnd,
                    ]}
                  >
                    <Text style={styles.endpointText}>{isStart ? 'A' : 'B'}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {screenTapPulse ? (
            <Animated.View
              pointerEvents="none"
              key={`screen-pulse-${screenTapPulse.key}`}
              style={[
                styles.screenTapPulse,
                {
                  left: screenTapPulse.x - 30,
                  top: screenTapPulse.y - 30,
                  opacity: screenTapPulseOpacity,
                  transform: [{ scale: screenTapPulseScale }],
                },
              ]}
            />
          ) : null}

          {slotTapPulse ? (
            <Animated.View
              pointerEvents="none"
              key={`slot-pulse-${slotTapPulse.key}`}
              style={[
                styles.tapPulse,
                {
                  left: slotTapPulse.x - 18,
                  top: slotTapPulse.y - 18,
                  opacity: slotTapPulseOpacity,
                  transform: [{ scale: slotTapPulseScale }],
                },
              ]}
            />
          ) : null}
        </View>

        {endpointIndicators.map((indicator) => {
          const isStart = indicator.id === 'start';
          return (
            <Pressable
              key={`indicator-${indicator.id}`}
              hitSlop={10}
              style={[
                styles.endpointIndicator,
                {
                  left: indicator.x - 22,
                  top: indicator.y - 22,
                },
              ]}
              onPress={() => {
                triggerHaptic('light');
                centerOnSlot(indicator.slotId);
              }}
            >
              <View
                style={[
                  styles.endpointIndicatorBadge,
                  isStart ? styles.endpointStart : styles.endpointEnd,
                ]}
              >
                <Text style={styles.endpointIndicatorText}>{isStart ? 'A' : 'B'}</Text>
              </View>
              <View
                style={[
                  styles.endpointIndicatorArrowWrap,
                  {
                    transform: [{ rotate: `${indicator.angle}rad` }],
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color="#dce8fa"
                  style={styles.endpointIndicatorArrowIcon}
                />
              </View>
            </Pressable>
          );
        })}

        {blockedMessage ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.blockedToast,
              {
                top: blockedToastTop,
                transform: [{ translateX: shakeX }],
              },
            ]}
          >
            <Text style={styles.blockedToastText}>{blockedMessage}</Text>
          </Animated.View>
        ) : null}

        {deletePrompt ? (
          <Pressable
            style={[
              styles.deletePrompt,
              {
                left: deletePrompt.x,
                top: deletePrompt.y,
              },
            ]}
            onPress={() => deleteEndpointById(deletePrompt.endpointId)}
          >
            <Text style={styles.deletePromptText}>Delete</Text>
          </Pressable>
        ) : null}

        <Pressable
          hitSlop={12}
          style={[styles.logoButton, { top: topControlsTop }]}
          onPress={handleLogoPress}
          onLongPress={showLogoHint}
          accessibilityLabel="Tunnel Navigator"
        >
          <MaterialCommunityIcons name="compass-rose" size={28} color="#86cbff" />
        </Pressable>

        {logoHintVisible ? (
          <Animated.View
            style={[
              styles.logoHintBubble,
              {
                top: 15 + topInset,
                opacity: logoHintOpacity,
                transform: [{ translateX: logoHintTranslateX }],
              },
            ]}
          >
            <Text style={styles.logoHintText}>Tunnel Navigator</Text>
          </Animated.View>
        ) : null}

        <View style={[styles.topRightControls, { top: topControlsTop }]}>
          <Pressable
            hitSlop={10}
            style={({ pressed }) => [styles.focusIconButton, pressed ? styles.dockButtonPressed : null]}
            onPress={() => {
              triggerHaptic('light');
              centerOnSlot(defaultCenterSlotId, getPreferredFocusScale());
            }}
            onLongPress={showFocusHint}
            accessibilityLabel="Focus map"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color="#dce8fa" />
          </Pressable>
          <Pressable
            hitSlop={10}
            style={({ pressed }) => [styles.routeInfoIconButton, pressed ? styles.dockButtonPressed : null]}
            onPress={() => {
              setFocusHintVisible(false);
              focusHintAnim.setValue(0);
              setRouteInfoOpen((previous) => {
                if (previous) {
                  return false;
                }

                setInfoTab('route');
                return true;
              });
            }}
            accessibilityLabel="Route info"
          >
            <MaterialCommunityIcons name="information-outline" size={21} color="#dce8fa" />
          </Pressable>
        </View>

        {focusHintVisible ? (
          <Animated.View
            style={[
              styles.focusHintBubble,
              {
                top: topControlsTop + 3,
                opacity: focusHintOpacity,
                transform: [{ translateX: focusHintTranslateX }],
              },
            ]}
          >
            <Text style={styles.focusHintText}>Center</Text>
          </Animated.View>
        ) : null}
        {routeInfoOpen ? (
          <View style={[styles.routeInfoPopover, { top: 58 + topInset }]}>
            <View style={styles.infoTabsRow}>
              <Pressable
                style={[styles.infoTabButton, infoTab === 'route' ? styles.infoTabButtonActive : null]}
                onPress={() => setInfoTab('route')}
              >
                <Text style={[styles.infoTabText, infoTab === 'route' ? styles.infoTabTextActive : null]}>Route</Text>
              </Pressable>
              <Pressable
                style={[styles.infoTabButton, infoTab === 'legend' ? styles.infoTabButtonActive : null]}
                onPress={() => setInfoTab('legend')}
              >
                <Text style={[styles.infoTabText, infoTab === 'legend' ? styles.infoTabTextActive : null]}>Legend</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                style={[styles.infoPinButton, routeInfoPinned ? styles.infoPinButtonActive : null]}
                onPress={() => {
                  setRouteInfoPinned((previous) => !previous);
                  triggerHaptic('light');
                }}
                accessibilityLabel={routeInfoPinned ? 'Info menu pinned' : 'Info menu auto-retract'}
              >
                <MaterialCommunityIcons
                  name={routeInfoPinned ? 'pin' : 'pin-outline'}
                  size={15}
                  color={routeInfoPinned ? '#eef6ff' : '#c7d8ef'}
                />
              </Pressable>
            </View>

            {infoTab === 'route' ? (
              routes.length > 0 ? (
                <View style={styles.routeStatsRow}>
                  <View style={styles.routeStatCard}>
                    <Text style={styles.routeStatLabel}>Distance</Text>
                    <Text style={styles.routeStatValue}>{routes[0].distance}</Text>
                  </View>
                  <View style={styles.routeStatCard}>
                    <Text style={styles.routeStatLabel}>Equal Paths</Text>
                    <Text style={styles.routeStatValue}>{routes.length}</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.routeInfoPopoverText}>Select two slots to calculate route.</Text>
              )
            ) : (
              <View style={styles.legendWrap}>
                <Text style={styles.legendSectionTitle}>Slots</Text>
                <View style={styles.legendRow}>
                  <View style={[styles.legendSlotSwatch, { borderColor: NODE_TYPE_COLORS.building }]} />
                  <Text style={styles.legendRowText}>Building</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendSlotSwatch, { borderColor: NODE_TYPE_COLORS.junction }]} />
                  <Text style={styles.legendRowText}>Junction</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendSlotSwatch, { borderColor: NODE_TYPE_COLORS.intersection }]} />
                  <Text style={styles.legendRowText}>Intersection</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendSlotSwatch, { borderColor: NODE_TYPE_COLORS.stairs }]} />
                  <Text style={styles.legendRowText}>Stairs</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendSlotSwatch, { borderColor: '#ffbe70', borderStyle: 'dashed' }]} />
                  <Text style={styles.legendRowText}>Exit-only slot</Text>
                </View>

                <Text style={[styles.legendSectionTitle, styles.legendSectionSpacing]}>Edges</Text>
                <View style={styles.legendRow}>
                  <View style={[styles.legendEdgeSwatch, { backgroundColor: EDGE_TYPE_COLORS.flat }]} />
                  <Text style={styles.legendRowText}>Flat</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendEdgeSwatch, { backgroundColor: EDGE_TYPE_COLORS.ramp }]} />
                  <MaterialCommunityIcons name="trending-up" size={12} color="#dbe8fb" style={styles.legendEdgeIcon} />
                  <Text style={styles.legendRowText}>Ramp</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendEdgeSwatch, { backgroundColor: EDGE_TYPE_COLORS.stairs }]} />
                  <MaterialCommunityIcons name="stairs" size={12} color="#dbe8fb" style={styles.legendEdgeIcon} />
                  <Text style={styles.legendRowText}>Stairs</Text>
                </View>

                <Text style={[styles.legendSectionTitle, styles.legendSectionSpacing]}>Routes</Text>
                <View style={styles.legendRow}>
                  <View style={styles.legendRouteSwatchRow}>
                    <View style={[styles.legendEdgeSwatch, { backgroundColor: ROUTE_COLORS[0] }]} />
                    <View style={[styles.legendEdgeSwatch, { backgroundColor: ROUTE_COLORS[1] }]} />
                  </View>
                  <Text style={styles.legendRowText}>Distinct shortest paths</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendEdgeSwatch, { backgroundColor: SHARED_ROUTE_COLOR }]} />
                  <Text style={styles.legendRowText}>Shared edge across paths</Text>
                </View>
                <View style={styles.legendRow}>
                  <MaterialCommunityIcons name="chevron-right" size={14} color="#f4f8ff" />
                  <Text style={styles.legendRowText}>Primary path travel direction</Text>
                </View>
              </View>
            )}
          </View>
        ) : null}

        {activeToolHoldAction ? (
          <View pointerEvents="none" style={styles.toolsHoldCenterOverlay}>
            <View style={styles.toolsHoldCenterVisual}>
              <View style={styles.toolsHoldCenterIconWrap}>
                <MaterialCommunityIcons
                  name={activeToolHoldAction === 'swap' ? 'swap-horizontal-bold' : 'restart'}
                  size={TOOLS_CENTER_HOLD_ICON_SIZE}
                  color="#36516f"
                />
                {activeToolHoldAction === 'swap' ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.toolsHoldCenterFillClipCenter,
                      {
                        left: swapHoldCenterInset,
                        right: swapHoldCenterInset,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="swap-horizontal-bold" size={TOOLS_CENTER_HOLD_ICON_SIZE} color="#86c8ff" />
                  </Animated.View>
                ) : (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.toolsHoldCenterFillClipFromRight,
                      { width: clearHoldCenterWidth },
                    ]}
                  >
                    <MaterialCommunityIcons name="restart" size={TOOLS_CENTER_HOLD_ICON_SIZE} color="#86c8ff" />
                  </Animated.View>
                )}
              </View>
            </View>
          </View>
        ) : null}

        {!draggingEndpoint ? (
          <View style={[styles.toolsDock, { bottom: 10 + bottomInset }]}>
            <Animated.View
              pointerEvents={toolsDockOpen ? 'auto' : 'none'}
              style={[
                styles.toolsDockTray,
                {
                  opacity: toolsDockAnim,
                  transform: [{ translateX: toolsDockTranslateX }],
                },
              ]}
            >
              <View style={styles.toolsDockHintStrip}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="clip"
                  style={[
                    styles.toolsDockHintStripText,
                    activeToolHoldAction ? styles.toolsDockHintStripTextActive : null,
                  ]}
                >
                  {toolsHoldHintText}
                </Text>
                <View style={styles.toolsDockHoldTrack}>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.toolsDockHoldFill,
                      activeToolHoldAction === 'swap'
                        ? { width: swapHoldProgressWidth }
                        : activeToolHoldAction === 'clear'
                          ? { width: clearHoldProgressWidth }
                          : styles.toolsDockHoldFillHidden,
                    ]}
                  />
                </View>
              </View>
              <View style={styles.toolsDockActionsRow}>
              <Pressable
                hitSlop={10}
                style={({ pressed }) => [
                  styles.toolsDockIconButton,
                  endpoints.length !== 2 ? styles.toolsDockButtonDisabled : null,
                  pressed ? styles.dockButtonPressed : null,
                ]}
                disabled={endpoints.length !== 2}
                onPressIn={() => startToolHold('swap', swapEndpoints)}
                onPressOut={() => releaseToolHold('swap')}
                accessibilityLabel="Hold to swap endpoints"
              >
                <View style={styles.toolsDockIconWrap}>
                  <MaterialCommunityIcons
                    name="swap-horizontal"
                    size={TOOLS_DOCK_ICON_SIZE}
                    color={endpoints.length !== 2 ? '#7489a8' : (activeToolHoldAction === 'swap' ? '#8ec5ff' : '#dce8fa')}
                  />
                </View>
              </Pressable>
              <Pressable
                hitSlop={10}
                style={({ pressed }) => [
                  styles.toolsDockIconButton,
                  pressed ? styles.dockButtonPressed : null,
                ]}
                onPressIn={() => startToolHold('clear', clearEndpoints)}
                onPressOut={() => releaseToolHold('clear')}
                accessibilityLabel="Hold to clear endpoints"
              >
                <View style={styles.toolsDockIconWrap}>
                  <MaterialCommunityIcons
                    name="restart"
                    size={TOOLS_DOCK_ICON_SIZE}
                    color={activeToolHoldAction === 'clear' ? '#8ec5ff' : '#dce8fa'}
                  />
                </View>
              </Pressable>
              <Pressable
                hitSlop={10}
                style={({ pressed }) => [
                  styles.toolsDockIconButton,
                  toolsPinned ? styles.toolsDockIconButtonActive : null,
                  pressed ? styles.dockButtonPressed : null,
                ]}
                onPress={() => {
                  setToolsPinned((previous) => !previous);
                  triggerHaptic('light');
                }}
                accessibilityLabel={toolsPinned ? 'Pinned tools' : 'Unpinned tools'}
              >
                <MaterialCommunityIcons
                  name={toolsPinned ? 'pin' : 'pin-outline'}
                  size={TOOLS_DOCK_ICON_SIZE}
                  color={toolsPinned ? '#8ec5ff' : '#dce8fa'}
                />
              </Pressable>
              {EDIT_LAYOUT_ENABLED ? (
                <Pressable
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.toolsDockButton,
                    editLayoutMode ? styles.toolsDockButtonActive : null,
                    pressed ? styles.dockButtonPressed : null,
                  ]}
                  onPress={() => runToolAction(() => setEditLayoutMode((previous) => !previous))}
                >
                  <Text style={styles.toolsDockButtonText}>{editLayoutMode ? 'Done' : 'Edit'}</Text>
                </Pressable>
              ) : null}
              {EDIT_LAYOUT_ENABLED && editLayoutMode ? (
                <>
                  <Pressable
                    hitSlop={10}
                    style={({ pressed }) => [styles.toolsDockButton, pressed ? styles.dockButtonPressed : null]}
                    onPress={() => runToolAction(() => setGridSizeIndex((previous) => (previous + 1) % GRID_SIZE_OPTIONS.length))}
                  >
                    <Text style={styles.toolsDockButtonText}>Grid {gridSize}</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    style={({ pressed }) => [styles.toolsDockButton, pressed ? styles.dockButtonPressed : null]}
                    onPress={() => runToolAction(() => setExportVisible(true))}
                  >
                    <Text style={styles.toolsDockButtonText}>Export</Text>
                  </Pressable>
                </>
              ) : null}
              </View>
            </Animated.View>
            <Pressable
              hitSlop={12}
              style={[styles.toolsMainButton, toolsDockOpen ? styles.toolsMainButtonActive : null]}
              onPress={() => {
                triggerHaptic('light');
                setToolsDockOpen((previous) => {
                  if (previous && toolsPinned) {
                    setToolsPinned(false);
                  }
                  return !previous;
                });
              }}
              accessibilityLabel={toolsDockOpen ? 'Close tools' : 'Open tools'}
            >
              <MaterialCommunityIcons
                name={toolsDockOpen ? 'close' : 'tools'}
                size={21}
                color="#dce8fa"
              />
            </Pressable>
          </View>
        ) : null}

        {DEBUG_UI_ENABLED && toolsDockOpen ? (
          <View pointerEvents="none" style={[styles.debugPill, { bottom: 10 + bottomInset }]}>
            <Text style={styles.debugPillText}>
              {`slots:${slots.length} scale:${viewport.scale.toFixed(2)} tx:${Math.round(viewport.tx)} ty:${Math.round(viewport.ty)} view:${Math.round(viewportSize.width)}x${Math.round(viewportSize.height)}`}
            </Text>
          </View>
        ) : null}
      </View>

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
                <Text style={[styles.edgeEditorMeta, styles.edgeEditorMetaSpacing]}>Type: {selectedEdge.type}</Text>

                <View style={[styles.edgeEditorRow, styles.edgeEditorRowSpacing]}>
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

                <View style={[styles.edgeEditorRow, styles.edgeEditorRowSpacing]}>
                  <Text style={styles.edgeEditorLabel}>Mode</Text>
                  <Pressable style={styles.edgeEditorActionBtn} onPress={toggleSelectedEdgeMode}>
                    <Text style={styles.edgeEditorActionBtnText}>
                      {selectedEdge.render?.mode ?? 'straight'}
                    </Text>
                  </Pressable>
                </View>

                {(selectedEdge.render?.mode ?? 'straight') === 'orthogonal' ? (
                  <View style={[styles.edgeEditorRow, styles.edgeEditorRowSpacing]}>
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
            <Text style={styles.exportTitle}>Export graph + layout</Text>
            <Pressable style={styles.exportCloseButton} onPress={() => setExportVisible(false)}>
              <Text style={styles.exportCloseButtonText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.exportHint}>
            Copy both JSON blocks and replace src/data/graph.json and src/data/layout.json.
          </Text>

          <ScrollView style={styles.exportBody}>
            <Text selectable style={styles.exportCode}>
              {'// src/data/graph.json\n'}
              {exportTopologyJson}
              {'\n\n// src/data/layout.json\n'}
              {exportLayoutJson}
            </Text>
          </ScrollView>
        </View>
      </Modal>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d121a',
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
  },
  canvasBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0e1724',
  },
  sceneLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  edgeTrack: {
    position: 'absolute',
    overflow: 'visible',
  },
  edgeStroke: {
    position: 'absolute',
    left: 0,
    borderRadius: 6,
  },
  edgeFlowFill: {
    position: 'absolute',
    borderRadius: 6,
    backgroundColor: 'rgba(244, 251, 255, 0.56)',
  },
  edgeRampRail: {
    position: 'absolute',
    left: 0,
    width: '100%',
    height: 1.2,
    borderRadius: 1,
  },
  edgeStairsStep: {
    position: 'absolute',
    width: 1.3,
    height: 6,
    borderRadius: 1,
    backgroundColor: '#f9edf0',
  },
  routeDirectionMarkerWrap: {
    position: 'absolute',
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelChangeBadge: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 18, 30, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(191, 214, 247, 0.68)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0a1524',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
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
    overflow: 'visible',
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
    borderWidth: 2.8,
    shadowOpacity: 0.78,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    elevation: 7,
  },
  slotDropPreview: {
    borderColor: '#f6e05e',
    borderWidth: 3,
    backgroundColor: '#3c3416',
  },
  slotHoldFocus: {
    borderColor: '#d9e9ff',
    borderWidth: 3,
    backgroundColor: '#2a476c',
    shadowColor: '#9ec5ff',
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    transform: [{ scale: 1.03 }],
  },
  slotLabelConnector: {
    position: 'absolute',
    height: 1.5,
    borderRadius: 2,
    backgroundColor: 'rgba(216, 231, 255, 0.88)',
    zIndex: 2,
  },
  slotLabel: {
    position: 'absolute',
    zIndex: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 29, 46, 0.72)',
    borderColor: 'rgba(140, 171, 216, 0.34)',
    borderWidth: 1,
    color: '#c6daf7',
    fontSize: 8.8,
    fontWeight: '600',
    letterSpacing: 0.1,
    textAlign: 'center',
    lineHeight: LABEL_LINE_HEIGHT,
    includeFontPadding: false,
    textShadowColor: 'rgba(3, 8, 14, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
    shadowColor: '#0b1524',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
  },
  slotLabelExpandedOverlay: {
    zIndex: 4,
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
  tapPulse: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#9fc7ff',
    backgroundColor: 'rgba(128, 182, 255, 0.2)',
  },
  screenTapPulse: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(176, 198, 228, 0.65)',
    backgroundColor: 'rgba(134, 166, 212, 0.12)',
  },
  endpointIndicator: {
    position: 'absolute',
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endpointIndicatorBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endpointIndicatorText: {
    color: '#f4f8ff',
    fontWeight: '800',
    fontSize: 12,
  },
  endpointIndicatorArrowWrap: {
    position: 'absolute',
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endpointIndicatorArrowIcon: {
    marginLeft: 25,
  },
  slotLabelOnHighlightedRoute: {
    backgroundColor: 'rgba(14, 26, 40, 0.4)',
    borderColor: 'rgba(209, 228, 255, 0.28)',
    borderWidth: 1,
  },
  slotLabelRouteWindow: {
    backgroundColor: 'rgba(10, 20, 32, 0.3)',
    borderColor: 'rgba(186, 213, 246, 0.26)',
  },
  slotLabelFocused: {
    backgroundColor: 'rgba(20, 37, 58, 0.75)',
    borderColor: 'rgba(204, 225, 255, 0.78)',
    borderWidth: 1,
    color: '#e3efff',
    shadowColor: '#9ec8ff',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
  },
  deletePrompt: {
    position: 'absolute',
    width: DELETE_PROMPT_WIDTH,
    height: DELETE_PROMPT_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9f5060',
    backgroundColor: 'rgba(122, 40, 56, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2f0f18',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 8,
  },
  deletePromptText: {
    color: '#ffe1e8',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  touchLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  logoButton: {
    position: 'absolute',
    left: 12,
    width: 50,
    height: 50,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2f5f8d',
    backgroundColor: '#17324f',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#06101d',
    shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 8,
  },
  logoHintBubble: {
    position: 'absolute',
    left: 70,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    backgroundColor: 'rgba(18, 47, 77, 0.97)',
    borderWidth: 1,
    borderColor: '#4c83b9',
    paddingHorizontal: 11,
    paddingVertical: 10,
    shadowColor: '#06101d',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  logoHintText: {
    color: '#e9f4ff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  topRightControls: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  focusIconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#162338',
    borderWidth: 1,
    borderColor: '#355176',
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusHintBubble: {
    position: 'absolute',
    right: 102,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 24, 36, 0.96)',
    borderWidth: 1,
    borderColor: '#314d72',
    paddingHorizontal: 9,
    paddingVertical: 4,
    minHeight: 32,
    justifyContent: 'center',
  },
  focusHintText: {
    color: '#dce8fa',
    fontSize: 11,
    fontWeight: '700',
  },
  dockButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  routeInfoIconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#162338',
    borderWidth: 1,
    borderColor: '#355176',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeInfoPopover: {
    position: 'absolute',
    right: 12,
    minWidth: 220,
    borderRadius: 14,
    backgroundColor: '#111d2d',
    borderWidth: 1,
    borderColor: '#355176',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  routeInfoPopoverText: {
    color: '#bfd1ec',
    fontSize: 11.5,
    lineHeight: 17,
  },
  routeStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  routeStatCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a577d',
    backgroundColor: '#14253a',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  routeStatLabel: {
    color: '#9db3d4',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  routeStatValue: {
    marginTop: 3,
    color: '#e6f0ff',
    fontSize: 16,
    fontWeight: '800',
  },
  infoTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  infoTabButton: {
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#345174',
    backgroundColor: '#14253a',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoTabButtonActive: {
    backgroundColor: '#2a7af5',
    borderColor: '#5d9bff',
  },
  infoPinButton: {
    width: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#345174',
    backgroundColor: '#14253a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPinButtonActive: {
    backgroundColor: '#2a7af5',
    borderColor: '#5d9bff',
  },
  infoTabText: {
    color: '#bcd0ee',
    fontSize: 11,
    fontWeight: '700',
  },
  infoTabTextActive: {
    color: '#f3f8ff',
  },
  legendWrap: {
    paddingTop: 2,
  },
  legendSectionTitle: {
    color: '#a9bfe0',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  legendSectionSpacing: {
    marginTop: 9,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  legendSlotSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    backgroundColor: '#132033',
  },
  legendEdgeSwatch: {
    width: 26,
    height: 4,
    borderRadius: 3,
  },
  legendEdgeIcon: {
    marginLeft: 6,
  },
  legendRouteSwatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendRowText: {
    marginLeft: 8,
    color: '#c7d8ef',
    fontSize: 11,
  },
  toolsDock: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolsHoldCenterOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolsHoldCenterVisual: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsHoldCenterIconWrap: {
    width: TOOLS_CENTER_HOLD_WRAP_SIZE,
    height: TOOLS_CENTER_HOLD_WRAP_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsHoldCenterFillClipFromRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  toolsHoldCenterFillClipCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsDockTray: {
    marginRight: 8,
    maxWidth: '78%',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    backgroundColor: 'rgba(16, 26, 38, 0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#355176',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  toolsDockHintStrip: {
    width: TOOLS_HOLD_PROGRESS_WIDTH + 16,
    minHeight: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2c4565',
    backgroundColor: 'rgba(13, 21, 33, 0.88)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    alignSelf: 'center',
  },
  toolsDockHintStripText: {
    flexShrink: 1,
    marginRight: 6,
    color: '#a9bfdc',
    fontSize: 10,
    fontWeight: '700',
  },
  toolsDockHintStripTextActive: {
    color: '#d7e9ff',
  },
  toolsDockHoldTrack: {
    width: 86,
    height: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#355272',
    backgroundColor: '#18283a',
    overflow: 'hidden',
  },
  toolsDockHoldFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#68b1ff',
  },
  toolsDockHoldFillHidden: {
    width: 0,
    opacity: 0,
  },
  toolsDockActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  toolsDockButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#1d2c42',
    borderWidth: 1,
    borderColor: '#3b5a84',
  },
  toolsDockIconButton: {
    minWidth: TOOLS_DOCK_ICON_WRAP_SIZE,
    minHeight: TOOLS_DOCK_ICON_WRAP_SIZE,
    paddingHorizontal: 2,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    position: 'relative',
    overflow: 'visible',
  },
  toolsDockIconButtonActive: {
    borderRadius: 8,
    backgroundColor: 'rgba(56, 96, 140, 0.55)',
  },
  toolsDockIconWrap: {
    width: TOOLS_DOCK_ICON_WRAP_SIZE,
    height: TOOLS_DOCK_ICON_WRAP_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsDockButtonActive: {
    backgroundColor: '#2a7af5',
    borderColor: '#5c99ff',
  },
  toolsDockButtonDisabled: {
    opacity: 0.45,
  },
  toolsDockButtonText: {
    color: '#dce8fa',
    fontSize: 12,
    fontWeight: '700',
  },
  toolsMainButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1a2537',
    borderWidth: 1,
    borderColor: '#324b6e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolsMainButtonActive: {
    backgroundColor: '#244f8a',
    borderColor: '#5a9dff',
  },
  debugPill: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(6, 11, 19, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(127, 156, 196, 0.42)',
  },
  debugPillText: {
    color: '#9fbbe3',
    fontSize: 10,
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
  edgeEditorMetaSpacing: {
    marginTop: 2,
  },
  edgeEditorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  edgeEditorRowSpacing: {
    marginTop: 10,
  },
  edgeEditorLabel: {
    color: '#d6e4fa',
    fontSize: 13,
    fontWeight: '600',
  },
  edgeEditorStepper: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginHorizontal: 8,
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

