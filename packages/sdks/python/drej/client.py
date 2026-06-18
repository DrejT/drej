import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Generator
from typing import Any


class DrejError(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


class DrejClient:
    def __init__(self, base_url: str = "http://localhost:3000") -> None:
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status == 204:
                    return None
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise DrejError("drej API error", e.code) from e

    def _stream(
        self, method: str, path: str, body: dict | None = None
    ) -> Generator[dict, None, None]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req) as resp:
                buf = ""
                while True:
                    chunk = resp.read(4096).decode("utf-8", errors="replace")
                    if not chunk:
                        break
                    buf += chunk
                    while "\n\n" in buf:
                        block, buf = buf.split("\n\n", 1)
                        if not block.strip():
                            continue
                        data_line: str | None = None
                        for line in block.split("\n"):
                            if line.startswith("data:"):
                                data_line = line[5:].strip()
                        if data_line is not None:
                            yield json.loads(data_line)
        except urllib.error.HTTPError as e:
            raise DrejError("drej API error", e.code) from e

    # ── Health ────────────────────────────────────────────────────────────

    def health(self) -> dict:
        return self._request("GET", "/health")

    # ── Sandbox lifecycle ─────────────────────────────────────────────────

    def create_sandbox(
        self,
        *,
        image: dict | None = None,
        snapshot_id: str | None = None,
        timeout: int | None = None,
        resource_limits: dict | None = None,
        entrypoint: list[str] | None = None,
        env: dict[str, str] | None = None,
        metadata: dict[str, str] | None = None,
        secure_access: bool | None = None,
    ) -> dict:
        body: dict = {}
        if image is not None:
            body["image"] = image
        if snapshot_id is not None:
            body["snapshotId"] = snapshot_id
        if timeout is not None:
            body["timeout"] = timeout
        if resource_limits is not None:
            body["resourceLimits"] = resource_limits
        if entrypoint is not None:
            body["entrypoint"] = entrypoint
        if env is not None:
            body["env"] = env
        if metadata is not None:
            body["metadata"] = metadata
        if secure_access is not None:
            body["secureAccess"] = secure_access
        return self._request("POST", "/v1/sandboxes", body)

    def list_sandboxes(
        self,
        *,
        state: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[dict]:
        params: list[str] = []
        if state is not None:
            params.append(f"state={urllib.parse.quote(state)}")
        if limit is not None:
            params.append(f"limit={limit}")
        if offset is not None:
            params.append(f"offset={offset}")
        qs = "?" + "&".join(params) if params else ""
        return self._request("GET", f"/v1/sandboxes{qs}")

    def get_sandbox(self, sandbox_id: str) -> dict:
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}")

    def delete_sandbox(self, sandbox_id: str) -> None:
        self._request("DELETE", f"/v1/sandboxes/{sandbox_id}")

    def pause_sandbox(self, sandbox_id: str) -> None:
        self._request("POST", f"/v1/sandboxes/{sandbox_id}/pause")

    def resume_sandbox(self, sandbox_id: str) -> None:
        self._request("POST", f"/v1/sandboxes/{sandbox_id}/resume")

    def renew_sandbox(self, sandbox_id: str) -> None:
        self._request("POST", f"/v1/sandboxes/{sandbox_id}/renew")

    def wait_for_running(
        self,
        sandbox_id: str,
        *,
        timeout_ms: int = 60_000,
        poll_interval_ms: int = 1_000,
    ) -> dict:
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            sandbox = self.get_sandbox(sandbox_id)
            state = sandbox["status"]["state"]
            if state == "Running":
                return sandbox
            if state in ("Failed", "Terminated"):
                raise DrejError(f"Sandbox {sandbox_id} entered state {state}", 500)
            time.sleep(poll_interval_ms / 1000)
        raise DrejError(
            f"Sandbox {sandbox_id} did not reach Running within {timeout_ms}ms", 408
        )

    # ── Snapshots ─────────────────────────────────────────────────────────

    def create_snapshot(self, sandbox_id: str) -> dict:
        return self._request("POST", f"/v1/sandboxes/{sandbox_id}/snapshots")

    def list_snapshots(
        self,
        *,
        sandbox_id: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[dict]:
        params: list[str] = []
        if sandbox_id is not None:
            params.append(f"sandboxId={sandbox_id}")
        if limit is not None:
            params.append(f"limit={limit}")
        if offset is not None:
            params.append(f"offset={offset}")
        qs = "?" + "&".join(params) if params else ""
        return self._request("GET", f"/v1/snapshots{qs}")

    def get_snapshot(self, snapshot_id: str) -> dict:
        return self._request("GET", f"/v1/snapshots/{snapshot_id}")

    def delete_snapshot(self, snapshot_id: str) -> None:
        self._request("DELETE", f"/v1/snapshots/{snapshot_id}")

    # ── Diagnostics ───────────────────────────────────────────────────────

    def get_diagnostic_logs(self, sandbox_id: str) -> list[dict]:
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/diagnostics/logs")

    def get_diagnostic_events(self, sandbox_id: str) -> list[dict]:
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/diagnostics/events")

    # ── Code execution ────────────────────────────────────────────────────

    def execute_code(
        self,
        sandbox_id: str,
        code: str,
        *,
        context: dict | None = None,
    ) -> Generator[dict, None, None]:
        body: dict = {"code": code}
        if context is not None:
            body["context"] = context
        return self._stream("POST", f"/v1/sandboxes/{sandbox_id}/exec/code", body)

    def interrupt_code(self, sandbox_id: str) -> None:
        self._request("DELETE", f"/v1/sandboxes/{sandbox_id}/exec/code")

    # ── Code contexts ─────────────────────────────────────────────────────

    def list_contexts(self, sandbox_id: str, language: str | None = None) -> list[dict]:
        qs = f"?language={urllib.parse.quote(language)}" if language else ""
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/exec/contexts{qs}")

    def create_context(self, sandbox_id: str, language: str) -> dict:
        return self._request(
            "POST", f"/v1/sandboxes/{sandbox_id}/exec/contexts", {"language": language}
        )

    def clear_contexts(self, sandbox_id: str, language: str | None = None) -> None:
        qs = f"?language={urllib.parse.quote(language)}" if language else ""
        self._request("DELETE", f"/v1/sandboxes/{sandbox_id}/exec/contexts{qs}")

    def delete_context(self, sandbox_id: str, context_id: str) -> None:
        self._request("DELETE", f"/v1/sandboxes/{sandbox_id}/exec/contexts/{context_id}")

    # ── Command execution ─────────────────────────────────────────────────

    def execute_command(
        self,
        sandbox_id: str,
        command: str,
        *,
        cwd: str | None = None,
        background: bool | None = None,
        timeout: int | None = None,
        uid: int | None = None,
        gid: int | None = None,
        envs: dict[str, str] | None = None,
    ) -> Generator[dict, None, None]:
        body: dict = {"command": command}
        if cwd is not None:
            body["cwd"] = cwd
        if background is not None:
            body["background"] = background
        if timeout is not None:
            body["timeout"] = timeout
        if uid is not None:
            body["uid"] = uid
        if gid is not None:
            body["gid"] = gid
        if envs is not None:
            body["envs"] = envs
        return self._stream("POST", f"/v1/sandboxes/{sandbox_id}/exec/command", body)

    def interrupt_command(self, sandbox_id: str) -> None:
        self._request("DELETE", f"/v1/sandboxes/{sandbox_id}/exec/command")

    def get_command_status(self, sandbox_id: str, session: str) -> dict:
        return self._request(
            "GET", f"/v1/sandboxes/{sandbox_id}/exec/command/status/{session}"
        )

    def get_command_output(self, sandbox_id: str, session: str) -> dict:
        return self._request(
            "GET", f"/v1/sandboxes/{sandbox_id}/exec/command/output/{session}"
        )

    # ── Files ─────────────────────────────────────────────────────────────

    def get_file_info(self, sandbox_id: str, path: str) -> dict:
        return self._request(
            "GET",
            f"/v1/sandboxes/{sandbox_id}/files/info?path={urllib.parse.quote(path)}",
        )

    def delete_file(self, sandbox_id: str, path: str) -> None:
        self._request(
            "DELETE",
            f"/v1/sandboxes/{sandbox_id}/files?path={urllib.parse.quote(path)}",
        )

    def set_file_permissions(self, sandbox_id: str, path: str, mode: str) -> None:
        self._request(
            "POST",
            f"/v1/sandboxes/{sandbox_id}/files/permissions",
            {"path": path, "mode": mode},
        )

    def move_file(self, sandbox_id: str, from_path: str, to_path: str) -> None:
        self._request(
            "POST",
            f"/v1/sandboxes/{sandbox_id}/files/move",
            {"from": from_path, "to": to_path},
        )

    def search_files(
        self, sandbox_id: str, pattern: str, dir: str | None = None
    ) -> list[str]:
        params = f"pattern={urllib.parse.quote(pattern)}"
        if dir is not None:
            params += f"&dir={urllib.parse.quote(dir)}"
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/files/search?{params}")

    def replace_in_files(self, sandbox_id: str, replacements: list[dict]) -> None:
        self._request(
            "POST",
            f"/v1/sandboxes/{sandbox_id}/files/replace",
            {"replacements": replacements},
        )

    def upload_file(self, sandbox_id: str, path: str, content: bytes) -> None:
        filename = path.split("/")[-1]
        boundary = f"DrejBoundary{int(time.time() * 1000)}"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="path"\r\n\r\n'
            f"{path}\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            f"{self.base_url}/v1/sandboxes/{sandbox_id}/files/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req):
                pass
        except urllib.error.HTTPError as e:
            raise DrejError("drej API error", e.code) from e

    def download_file(self, sandbox_id: str, path: str) -> bytes:
        req = urllib.request.Request(
            f"{self.base_url}/v1/sandboxes/{sandbox_id}/files/download"
            f"?path={urllib.parse.quote(path)}"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise DrejError("drej API error", e.code) from e

    # ── Directories ───────────────────────────────────────────────────────

    def list_directory(
        self, sandbox_id: str, path: str, depth: int | None = None
    ) -> list[dict]:
        params = f"path={urllib.parse.quote(path)}"
        if depth is not None:
            params += f"&depth={depth}"
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/directories?{params}")

    def create_directory(self, sandbox_id: str, path: str) -> None:
        self._request("POST", f"/v1/sandboxes/{sandbox_id}/directories", {"path": path})

    def delete_directory(self, sandbox_id: str, path: str) -> None:
        self._request(
            "DELETE",
            f"/v1/sandboxes/{sandbox_id}/directories?path={urllib.parse.quote(path)}",
        )

    # ── Metrics ───────────────────────────────────────────────────────────

    def get_metrics(self, sandbox_id: str) -> dict:
        return self._request("GET", f"/v1/sandboxes/{sandbox_id}/metrics")

    def watch_metrics(self, sandbox_id: str) -> Generator[dict, None, None]:
        return self._stream("GET", f"/v1/sandboxes/{sandbox_id}/metrics/watch")
