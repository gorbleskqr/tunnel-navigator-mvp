# Terminology

This file is the single source of truth for project terminology.

When a new term is introduced in chat or implementation, update this file in the same PR.

## Core Vocabulary

| Term | Canonical Meaning | Notes |
| --- | --- | --- |
| node | A topology entity in `src/data/graph.json` (`GraphNode`). | May have aliases and a `NodeType`. |
| slot | A positioned canvas instance of a node (`Slot`). | Built from node + layout coordinates. |
| edge | A connection between two nodes/slots in topology (`Edge`). | Base topology lives in `graph.json`; render hints are optional. |
| section | A tunnel section grouping one or more edges by section identity (for parity mapping). | Preferred over `line` for data semantics. |
| section path | A user-drawn slot-to-slot chain assigned to one section. | Expands into edge-to-section assignments. |
| section endpoints | Terminal (degree-1) handles for a committed section path. | Used for extend/retract adjustment in dev-env; branch slots do not render handles. |
| edge shaping | Dev-env function that lets an edge use control points instead of only straight/auto routes. | Enabled only while global Shaping mode is on in edit mode. |
| edge shaping mode | Explicit edit-mode toggle that enables hold-to-place anchor interaction on edges. | Off by default when entering dev-env. |
| anchor point | Snap-to-grid control point used by edge shaping on an edge segment. | Must snap to grid to be committed; max 3 per edge; edit-mode only. |
| edge tray | Inline edge editor panel used to edit one selected edge at a time. | Contains edge weight/mode/bend controls. |
| edge weight overlay | Optional dev-env on-canvas weight badges for faster visual tuning. | Supports `hidden`, `compact`, and `full` modes. |
| node category | Node type grouping (`building`, `junction`, `intersection`, `stairs`, `exterior`). | Global across canvas. |
| node category color | Global display color for a node category. | Not per section. |
| edge type | Traversal type (`flat`, `ramp`, `stairs`). | Distinct from section assignment. |
| endpoint | Route endpoint marker (`start` or `end`). | Selected by tap interaction. |

## Usage Rule

- If wording in chat conflicts with this file, this file wins until explicitly updated.
- If a term changes, update this file first, then update code/docs references in the same PR.
