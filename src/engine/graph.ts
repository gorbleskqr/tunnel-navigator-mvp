import { Graph, Node, Edge } from '../types/types';
import graphData from '../data/graph.json';

// Adjacency list: nodeId -> array of { neighborId, weight, edgeType }
export interface AdjacencyEntry {
    neighborId: string;
    weight: number;
    edgeType: string;
}

export type AdjacencyList = Map<string, AdjacencyEntry[]>;

// Build bidirectional adjacency list from graph JSON — O(E)
export function buildAdjacencyList(graph: Graph): AdjacencyList {
    const adjacency: AdjacencyList = new Map();

    // Initialize every node with an empty list
    for (const node of graph.nodes) {
        adjacency.set(node.id, []);
    }

    // Add both directions for each edge
    for (const edge of graph.edges) {
        adjacency.get(edge.from)!.push({
            neighborId: edge.to,
            weight: edge.weight,
            edgeType: edge.type,
        });
        adjacency.get(edge.to)!.push({
            neighborId: edge.from,
            weight: edge.weight,
            edgeType: edge.type,
        });
    }

    return adjacency;
}

// Node lookup map by id — O(1) access
export function buildNodeMap(graph: Graph): Map<string, Node> {
    const map = new Map<string, Node>();
    for (const node of graph.nodes) {
        map.set(node.id, node);
    }
    return map;
}

export const graph = graphData as Graph;
export const adjacencyList = buildAdjacencyList(graph);
export const nodeMap = buildNodeMap(graph);