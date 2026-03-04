export type NodeType = 'building' | 'junction' | 'intersection' | 'stairs' | 'exterior';
export type EdgeType = 'flat' | 'ramp' | 'stairs';

export interface Alias {
    label: string;
    type: NodeType;
}

export interface Node {
    id: string;
    label: string;
    type: NodeType;
    exitOnly: boolean;
    aliases: Alias[];
}

export interface Edge {
    from: string;
    to: string;
    weight: number;
    type: EdgeType;
}

export interface Graph {
    nodes: Node[];
    edges: Edge[];
}

export interface Route {
    path: string[];   // node ids
    distance: number;
}

export type RoutingMode = 'flat' | 'accessible';