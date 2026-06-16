# GOAL.md: Simplified Project Architecture for `drej`

## 1. Context & Objective
`drej` is an open-source, lightweight orchestration wrapper built on top of OpenSandbox. It lets AI agents execute untrusted code loops safely inside isolated environments. 

This configuration file acts as a direct structural blueprint to initialize a clean, lightweight, local-first monorepo development environment.

## 2. Core Constraints & Technical Stack
*   **Monorepo Engine:** Native **Bun Workspaces** (declared in the root `package.json`). Do not generate any `pnpm-workspace.yaml` files.
*   **Backend Server:** Bun Runtime + ElysiaJS API framework.
*   **SDK Languages:** Native **Python** and **TypeScript** folders only.
*   **No Code inside Responses:** Generate the repository structures entirely via system execution.

---

## 3. Simplified Repository Structure

```text
drej/
├── package.json              # Root Bun workspace configuration (private: true)
├── README.md
├── apps/
│   └── api/                  # Bun + ElysiaJS API Server
│       ├── src/
│       │   └── index.ts      # Main Elysia server entry point
│       └── package.json
└── packages/
    └── sdks/
        ├── python/           # Core Python SDK
        │   ├── drej/
        │   │   ├── __init__.py
        │   │   └── client.py  # HTTP client to communicate with Bun API
        │   └── pyproject.toml
        └── typescript/       # Core TypeScript SDK
            ├── src/
            │   ├── index.ts   # Core export layer
            │   └── client.ts  # HTTP client to communicate with Bun API
            └── package.json
```
