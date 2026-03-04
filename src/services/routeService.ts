import { Route, RoutingMode } from '../types/types';
import { adjacencyList, nodeMap } from '../engine/graph';
import { dijkstra } from '../engine/dijkstra';
import { buildAllPaths } from '../engine/pathBuilder';

export interface RoutingError {
    code: 'INVALID_NODE' | 'NO_PATH' | 'EXIT_ONLY_AS_END' | 'SAME_NODE';
    message: string;
}

export type RoutingResult =
    | { success: true; routes: Route[] }
    | { success: false; error: RoutingError };

export function getRoutes(
    startId: string,
    endId: string,
    mode: RoutingMode = 'flat'
): RoutingResult {
    // Validate nodes exist
    const startNode = nodeMap.get(startId);
    const endNode = nodeMap.get(endId);

    if (!startNode) {
        return { success: false, error: { code: 'INVALID_NODE', message: `Start node "${startId}" not found.` } };
    }
    if (!endNode) {
        return { success: false, error: { code: 'INVALID_NODE', message: `End node "${endId}" not found.` } };
    }

    // Validate exitOnly nodes can't be used as end
    if (endNode.exitOnly) {
        return { success: false, error: { code: 'EXIT_ONLY_AS_END', message: `"${endNode.label}" is an exit only — it can only be a starting point.` } };
    }

    // Same node
    if (startId === endId) {
        return { success: true, routes: [{ path: [startId], distance: 0 }] };
    }

    const { distances, predecessors } = dijkstra(startId, adjacencyList);
    const routes = buildAllPaths(startId, endId, predecessors, distances);

    if (routes.length === 0) {
        return { success: false, error: { code: 'NO_PATH', message: `No path found between "${startNode.label}" and "${endNode.label}".` } };
    }

    return { success: true, routes };
}