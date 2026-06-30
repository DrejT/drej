# drejx

CLI for [drej](https://drej.dev) — start a local OpenSandbox server, manage sandbox snapshots, and add pre-built sandbox environments from the registry.

```bash
bunx drejx init
```

---

## Commands

### `drejx init`

Starts an [OpenSandbox](https://open-sandbox.ai) server in Docker and writes config to `~/.config/drejx/server.toml` and `.drej/config.json`.

```bash
drejx init
```

When using a server started this way, pass `useServerProxy: true` to `new Drej(...)` — sandbox containers run on Docker's bridge network and aren't reachable directly from the host.

### `drejx add <url>`

Fetches a sandbox spec from the registry, builds it, and checkpoints it locally.

```bash
drejx add https://registry.drej.dev/python-data
```

### `drejx list`

Lists locally managed sandboxes from `.drej/sandboxes.json`.

```bash
drejx list
```

### `drejx remove <name>`

Removes a sandbox entry from the local list.

```bash
drejx remove python-data
```

---

## Manual server setup

If you prefer not to use Docker, run the server directly with `uvx`:

```bash
uvx opensandbox-server
```

With `~/.sandbox.toml`:

```toml
[server]
host = "127.0.0.1"
port = 8080

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.19"

[docker]
network_mode = "bridge"

[ingress]
mode = "direct"

[egress]
mode = "dns"
```

With this setup, leave `useServerProxy` unset (defaults to `false`) — the server is on the host, so direct container IPs are reachable.

---

## License

Apache 2.0
