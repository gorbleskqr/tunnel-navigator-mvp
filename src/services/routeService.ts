import { dijkstra } from '../engine/dijkstra';
import { AdjacencyList } from '../engine/graph';
import { buildAllPaths } from '../engine/pathBuilder';
import { Route } from '../types/types';

export function getRoutes(startId: string, endId: string, adjacencyList: AdjacencyList): Route[] {
  if (startId === endId) {
    return [{ path: [startId], distance: 0 }];
  }

  const { distances, predecessors } = dijkstra(startId, adjacencyList);
  return buildAllPaths(startId, endId, predecessors, distances);
}
