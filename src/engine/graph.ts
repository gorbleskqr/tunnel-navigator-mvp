import graphJson from '../data/graph.json';
import layoutJson from '../data/layout.json';
import { Edge, Graph, GraphLayout, GraphNode, GraphTopology } from '../types/types';

export interface AdjacencyEntry {
  neighborId: string;
  weight: number;
}

export type AdjacencyList = Map<string, AdjacencyEntry[]>;

export const graphTopology: GraphTopology = graphJson as GraphTopology;
export const graphLayout: GraphLayout = layoutJson as GraphLayout;
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
