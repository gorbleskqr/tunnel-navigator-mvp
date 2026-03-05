import { AdjacencyList } from './graph';

export interface DijkstraResult {
  distances: Map<string, number>;
  predecessors: Map<string, string[]>;
}

export function dijkstra(start: string, adjacency: AdjacencyList): DijkstraResult {
  const distances = new Map<string, number>();
  const predecessors = new Map<string, string[]>();
  const visited = new Set<string>();
  const queue: [string, number][] = [];

  for (const nodeId of adjacency.keys()) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    predecessors.set(nodeId, []);
  }

  distances.set(start, 0);
  queue.push([start, 0]);

  while (queue.length > 0) {
    queue.sort((a, b) => a[1] - b[1]);
    const [currentId, currentDistance] = queue.shift() as [string, number];

    if (visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const neighbors = adjacency.get(currentId) ?? [];

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.neighborId)) {
        continue;
      }

      const candidateDistance = currentDistance + neighbor.weight;
      const bestDistance = distances.get(neighbor.neighborId) ?? Number.POSITIVE_INFINITY;

      if (candidateDistance < bestDistance) {
        distances.set(neighbor.neighborId, candidateDistance);
        predecessors.set(neighbor.neighborId, [currentId]);
        queue.push([neighbor.neighborId, candidateDistance]);
      } else if (candidateDistance === bestDistance) {
        predecessors.get(neighbor.neighborId)?.push(currentId);
      }
    }
  }

  return { distances, predecessors };
}
