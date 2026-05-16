# CLAUDE.md — Project rules for Claude Code

## Phase completion protocol

At the end of every phase, before moving to the next one:

1. Run the phase verification (tests, lint, and/or build as appropriate).
2. Make a git commit with a message describing what the phase built and any autonomous decisions made.
   - Format: `phase-N: <short description>`
   - Include a brief note on any non-obvious choices made autonomously (e.g. data model deviations, alternative implementations).
