import { Route } from '../types/types';

// Reconstruct all shortest paths via DFS on predecessor map — O(P×L)
// P = number of shortest paths, L = path length
export function buildAllPaths(
    start: string,
    end: string,
    predecessors: Map<string, string[]>,
    distances: Map<string, number>
): Route[] {
    // No path exists
    if (distances.get(end) === Infinity) return [];

    // Start equals end
    if (start === end) {
        return [{ path: [start], distance: 0 }];
    }

    const distance = distances.get(end)!;
    const allPaths: string[][] = [];

    // DFS backwards from end to start using predecessor map
    function dfs(current: string, pathSoFar: string[]): void {
        if (current === start) {
            allPaths.push([...pathSoFar].reverse());
            return;
        }

        const preds = predecessors.get(current) ?? [];
        for (const pred of preds) {
            dfs(pred, [...pathSoFar, pred]);
        }
    }

    dfs(end, [end]);

    return allPaths.map(path => ({ path, distance }));
}