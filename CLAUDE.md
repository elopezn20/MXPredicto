# CLAUDE.md — Project rules for Claude Code

## Git workflow

For all non-trivial changes, use a feature branch and open a PR — do not push directly to `main`.

1. `git checkout -b feat/<short-description>` (or `fix/`, `chore/` as appropriate)
2. Make commits on the branch.
3. `git push -u origin <branch>`
4. `gh pr create` to open the PR.
5. Merge via GitHub (or `gh pr merge`) once approved.

Hotfixes that are a single trivial commit (e.g. a one-line copy or color tweak) may go directly to `main`.

## Phase completion protocol

At the end of every phase, before moving to the next one:

1. Run the phase verification (tests, lint, and/or build as appropriate).
2. Make a git commit with a message describing what the phase built and any autonomous decisions made.
   - Format: `phase-N: <short description>`
   - Include a brief note on any non-obvious choices made autonomously (e.g. data model deviations, alternative implementations).
