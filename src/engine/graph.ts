import graphJson from '../data/graph.json';
import layoutJson from '../data/layout.json';
import themeJson from '../data/theme.json';
import {
  Edge,
  Graph,
  GraphLayout,
  GraphNode,
  GraphTopology,
  ThemeConfig,
  NodeType,
  ResolvedThemeConfig,
} from '../types/types';

export interface AdjacencyEntry {
  neighborId: string;
  weight: number;
}

export type AdjacencyList = Map<string, AdjacencyEntry[]>;

const NODE_TYPES: NodeType[] = ['building', 'junction', 'intersection', 'stairs', 'exterior'];
const DEFAULT_NODE_TYPE_COLORS: Record<NodeType, string> = {
  building: '#3f96ff',
  junction: '#20b36f',
  intersection: '#f2a33a',
  stairs: '#db5b5b',
  exterior: '#706cff',
};

export const graphTopology: GraphTopology = graphJson as GraphTopology;
export const graphLayout: GraphLayout = layoutJson as GraphLayout;
export const themeConfig: ThemeConfig = normalizeThemeConfig(themeJson as ThemeConfig);
export const nodeTypeColors: Record<NodeType, string> = {
  ...DEFAULT_NODE_TYPE_COLORS,
  ...(themeConfig.nodeCategoryColors ?? {}),
};
export const resolvedThemeConfig: ResolvedThemeConfig = {
  sectionColors: { ...(themeConfig.sectionColors ?? {}) },
  edgeSections: { ...(themeConfig.edgeSections ?? {}) },
  nodeCategoryColors: { ...nodeTypeColors },
};
export const graph: Graph = buildGraph(graphTopology, graphLayout);

export function buildAdjacencyList(data: Pick<Graph, 'nodes' | 'edges'>): AdjacencyList {
  const adjacency: AdjacencyList = new Map();

  for (const node of data.nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of data.edges) {
    adjacency.get(edge.from)?.push({ neighborId: edge.to, weight: edge.weight });
    adjacency.get(edge.to)?.push({ neighborId: edge.from, weight: edge.weight });
  }

  return adjacency;
}

export function buildNodeMap(data: Graph): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();

  for (const node of data.nodes) {
    map.set(node.id, node);
  }

  return map;
}

export const adjacencyList = buildAdjacencyList(graph);
export const nodeMap = buildNodeMap(graph);

function buildGraph(topology: GraphTopology, layout: GraphLayout): Graph {
  const edgeRenderByKey = new Map<string, Edge['render']>();

  for (const hint of layout.edgeRenders ?? []) {
    edgeRenderByKey.set(edgeKey(hint.from, hint.to), hint.render);
  }

  return {
    nodes: topology.nodes.map((node) => ({ ...node })),
    edges: topology.edges.map((edge) => {
      const render = edgeRenderByKey.get(edgeKey(edge.from, edge.to));
      return render ? { ...edge, render } : { ...edge };
    }),
  };
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeThemeConfig(input: ThemeConfig | null | undefined): ThemeConfig {
  const normalizedSectionColors: Record<string, string> = {};
  const normalizedEdgeSections: Record<string, string> = {};
  const normalizedNodeCategoryColors: Partial<Record<NodeType, string>> = {};

  if (input?.sectionColors && typeof input.sectionColors === 'object') {
    for (const [sectionId, color] of Object.entries(input.sectionColors)) {
      const trimmedSectionId = sectionId.trim();
      if (trimmedSectionId.length === 0 || !isHexColor(color)) {
        continue;
      }

      normalizedSectionColors[trimmedSectionId] = color;
    }
  }

  if (input?.edgeSections && typeof input.edgeSections === 'object') {
    for (const [edgeId, sectionId] of Object.entries(input.edgeSections)) {
      const trimmedEdgeId = edgeId.trim();
      const trimmedSectionId = sectionId.trim();
      if (trimmedEdgeId.length === 0 || trimmedSectionId.length === 0) {
        continue;
      }

      normalizedEdgeSections[trimmedEdgeId] = trimmedSectionId;
    }
  }

  if (input?.nodeCategoryColors && typeof input.nodeCategoryColors === 'object') {
    for (const nodeType of NODE_TYPES) {
      const candidateColor = input.nodeCategoryColors[nodeType];
      if (candidateColor && isHexColor(candidateColor)) {
        normalizedNodeCategoryColors[nodeType] = candidateColor;
      }
    }
  }

  return {
    sectionColors: normalizedSectionColors,
    edgeSections: normalizedEdgeSections,
    nodeCategoryColors: normalizedNodeCategoryColors,
  };
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}
