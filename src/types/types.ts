export type NodeType = 'building' | 'junction' | 'intersection' | 'stairs' | 'exterior';
export type EdgeType = 'flat' | 'ramp' | 'stairs';

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
  x?: number;
  y?: number;
}

export interface Edge {
  from: string;
  to: string;
  weight: number;
  type: EdgeType;
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
