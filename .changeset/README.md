# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

## How to add a changeset

```bash
bunx changeset
```

Follow the prompts — pick the package (`@drej/sdk`), bump type (`patch` / `minor` / `major`), and write a short description. Commit the generated `.md` file alongside your PR.

## Release flow

1. Open a PR with your changes + a changeset file.
2. Merge to `main`.
3. The **Release** workflow opens (or updates) a "Version Packages" PR.
4. Merge that PR — the workflow publishes to npm automatically.
