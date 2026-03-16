# Architecture

This document will describe the production architecture and runtime boundaries.

TODO: add component-level architecture diagram and data-flow notes.

Canonical vocabulary lives in `docs/TERMINOLOGY.md`.

## Dev-Env Notes (Current PR State)

- Dev-only editing tools remain runtime-gated behind `EXPO_PUBLIC_ENABLE_LAYOUT_EDIT=1`.
- Current accepted behavior: edit-mode label behavior is improved and usable, but not fully identical to production display-mode label behavior in every case.
- This label parity gap is intentionally deferred for stability during ongoing dev-env tooling work.
