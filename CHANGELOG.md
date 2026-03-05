# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- None yet.

## [0.3.0] - 2026-03-05

### Added
- First stable mobile graph canvas baseline on Expo Go.
- Mobile-safe viewport spacing and status-bar handling.
- Distinct coloring for equal shortest paths.
- Slot-label overlap culling for better readability.

### Changed
- Switched scene rendering to screen-space projection for consistent web/mobile behavior.
- Refined delete interaction into a compact floating delete target.
- Mobile interaction model now prioritizes pinch zoom plus focus control.

### Fixed
- Mobile blank-canvas/runtime rendering regressions.
- Drag/hit-test inconsistencies for endpoint placement and movement.
- Touch interception issues from overlays during drag interactions.

## [0.2.0] - 2026-03-05

### Added
- Edge editor in layout mode.
- Edge weight editing by tapping edges.
- Optional orthogonal edge rendering with bend mode controls.
- Edge render metadata persistence in exported JSON.

## [0.1.1] - 2026-03-04

### Changed
- Kept slot labels visible in non-edit mode.
- Added distinct visual styling for exit-only slots.

## [0.1.0] - 2026-03-04

### Added
- Baseline interactive graph canvas with slot/node routing flow.
- Edit-layout mode with grid-assisted slot positioning and JSON export.
- Endpoint interactions: spawn, drag, snap-to-slot, swap, and delete.
- Shortest-path route highlighting for two selected endpoints.
