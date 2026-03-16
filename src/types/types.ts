export type NodeType = 'building' | 'junction' | 'intersection' | 'stairs' | 'exterior';
export type EdgeType = 'flat' | 'ramp' | 'stairs';
export type EdgeRenderMode = 'straight' | 'orthogonal';
export type EdgeBendMode = 'hv' | 'vh';

export interface Alias {
  label: string;
  type: NodeType;
}

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  exitOnly: boolean;
  aliases: Alias[];
}

export interface EdgeRenderConfig {
  mode: EdgeRenderMode;
  bend?: EdgeBendMode;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface Edge {
  from: string;
  to: string;
  weight: number;
  type: EdgeType;
  render?: EdgeRenderConfig;
}

export type TopologyEdge = Omit<Edge, 'render'>;

export interface GraphTopology {
  nodes: GraphNode[];
  edges: TopologyEdge[];
}

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
}

export interface EdgeRenderHint {
  from: string;
  to: string;
  render: EdgeRenderConfig;
}

export interface GraphLayout {
  slots: LayoutSlot[];
  edgeRenders?: EdgeRenderHint[];
  view?: {
    defaultCenterSlotId?: string;
  };
}

export interface ThemeConfig {
  sectionColors?: Record<string, string>;
  edgeSections?: Record<string, string>;
  nodeCategoryColors?: Partial<Record<NodeType, string>>;
}

export interface ResolvedThemeConfig {
  sectionColors: Record<string, string>;
  edgeSections: Record<string, string>;
  nodeCategoryColors: Record<NodeType, string>;
}

export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}

export interface Slot {
  id: string;
  x: number;
  y: number;
  node: GraphNode;
}

export type EndpointId = 'start' | 'end';

export interface Endpoint {
  id: EndpointId;
  slotId: string;
}

export interface Route {
  path: string[];
  distance: number;
}

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}
