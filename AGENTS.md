# AGENTS

This file defines project guardrails for any coding agent working in this repository.

## Branch + Merge Workflow

- Production branch is `main`.
- Create task branches from `main` only.
- Use one feature branch per PR.
- A feature branch can contain multiple scoped commits.
- Use descriptive branch names: `feature/<area>-<outcome>`.
- Open PRs from feature branches into `main`.
- Use squash merge with explicit `--subject` and `--body`.
- Delete merged feature branches after squash merge.

## Documentation Conventions

- Keep public project docs at root:
  - `README.md`
  - `CONTRIBUTING.md`
  - `CHANGELOG.md`
  - `LICENSE`
- Keep shared docs under `docs/`:
  - `GETTING_STARTED.md`
  - `ARCHITECTURE.md`
  - `API.md`
  - `DESIGN.md`
  - `WIREFRAME.md`
- Keep policy placeholders under `.github/`:
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
- Local-only scratch/workflow docs live in `docs/local/`.
- Entire `docs/local/` folder is intentionally gitignored.

## Mobile + Runtime Conventions

- Treat mobile interaction quality as priority: touch reliability, label readability, and route clarity.
- Avoid refactors to routing/graph engine internals unless required by the task.
- Keep production runtime stable; dev-only editing tools must be gated behind:
  - `EXPO_PUBLIC_ENABLE_LAYOUT_EDIT=1`
- Use `dev-env` terminology for these local editing capabilities.

## Critical File Guardrails

- Do not rewrite core graph data files unless task explicitly requires it:
  - `src/data/graph.json`
  - `src/data/layout.json`
- Do not remove existing route/gesture behavior without replacing with equivalent or better UX.
- Avoid broad style overhauls while mobile fixes are in progress.

## Delivery Expectations

- When implementing a task, update `docs/local/pr_drafts.md` with:
  - target branch name
  - PR title/body draft
  - squash merge subject/body
  - required semver tag (`vX.Y.Z`) and tag message for that PR merge
- Prefer small, reviewable commits grouped by behavior.
