# drej

## 0.2.1

### Patch Changes

- 5278aa9: Add `DrejError` and `run()` to the Python SDK, matching the TypeScript SDK's interface.

## 0.2.0

### Minor Changes

- c3fe034: Add `DrejClient.run(code)` method and `SandboxRunResult` type for submitting code to the sandbox execution endpoint.

### Patch Changes

- 3316570: Add `DrejError` class with HTTP status code — errors from API calls now throw `DrejError` instead of a generic `Error`.
