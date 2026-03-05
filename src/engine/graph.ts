import graphJson from '../data/graph.json';
import { Graph, GraphNode } from '../types/types';

export interface AdjacencyEntry {
  neighborId: string;
  weight: number;
}

export type AdjacencyList = Map<string, AdjacencyEntry[]>;

export const graph: Graph = graphJson as Graph;

export function buildAdjacencyList(data: Graph): AdjacencyList {
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
