import urllib.request
import urllib.error
import json


class DrejError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


class DrejClient:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise DrejError(f"drej API error", e.code) from e

    def health(self) -> dict:
        return self._request("GET", "/health")

    def run(self, code: str) -> dict:
        return self._request("POST", "/sandbox/run", {"code": code})
