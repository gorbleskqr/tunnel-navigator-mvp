import { AdjacencyList } from './graph';

export interface DijkstraResult {
  distances: Map<string, number>;
  predecessors: Map<string, string[]>; // multi-predecessor for equal shortest paths
}

// Dijkstra with multi-predecessor tracking — O((V+E) log V)
export function dijkstra(
  start: string,
  adjacency: AdjacencyList
): DijkstraResult {
  const distances = new Map<string, number>();
  const predecessors = new Map<string, string[]>();
  const visited = new Set<string>();

  // Priority queue as a sorted array [nodeId, distance]
  // For MVP scale this is fine — swap for a heap if graph grows significantly
  const queue: [string, number][] = [];

  // Initialize all distances to infinity
  for (const nodeId of adjacency.keys()) {
    distances.set(nodeId, Infinity);
    predecessors.set(nodeId, []);
  }

  distances.set(start, 0);
  queue.push([start, 0]);

  while (queue.length > 0) {
    // Sort ascending by distance and pop smallest
    queue.sort((a, b) => a[1] - b[1]);
    const [current, currentDist] = queue.shift()!;

    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current) ?? [];

    for (const { neighborId, weight } of neighbors) {
      if (visited.has(neighborId)) continue;

      const newDist = currentDist + weight;
      const bestDist = distances.get(neighborId) ?? Infinity;

      if (newDist < bestDist) {
        // Found a shorter path
        distances.set(neighborId, newDist);
        predecessors.set(neighborId, [current]);
        queue.push([neighborId, newDist]);
      } else if (newDist === bestDist) {
        // Equal length path — track all predecessors
        predecessors.get(neighborId)!.push(current);
      }
    }
  }

  return { distances, predecessors };
}