import { Route } from '../types/types';

export function buildAllPaths(
  start: string,
  end: string,
  predecessors: Map<string, string[]>,
  distances: Map<string, number>,
): Route[] {
  const bestDistance = distances.get(end);

  if (bestDistance === undefined || !Number.isFinite(bestDistance)) {
    return [];
  }

  if (start === end) {
    return [{ path: [start], distance: 0 }];
  }

  const allPaths: string[][] = [];

  function backtrack(current: string, path: string[]): void {
    if (current === start) {
      allPaths.push([...path].reverse());
      return;
    }

    const prev = predecessors.get(current) ?? [];
    for (const nodeId of prev) {
      path.push(nodeId);
      backtrack(nodeId, path);
      path.pop();
    }
  }

  backtrack(end, [end]);

  return allPaths.map((path) => ({
    path,
    distance: bestDistance,
  }));
}
