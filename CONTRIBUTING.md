# Contributing

## Branch Workflow

1. Branch from `main`: `feature/<area>-<outcome>`
2. Open PR back to `main`
3. Use squash merge with explicit subject/body
4. Delete merged feature branch

## Commit Style

Use Conventional Commits where possible:

- `feat(scope): ...`
- `fix(scope): ...`
- `chore(scope): ...`
- `docs(scope): ...`

## Pull Request Expectations

- Keep changes focused and reviewable
- Include manual validation notes for mobile/web behavior
- Update relevant docs (`CHANGELOG.md` and `docs/*`) when behavior changes

## Release + Tags

- Tag from `main` only
- Use semver intent:
  - patch: fixes
  - minor: feature additions
  - major: breaking changes