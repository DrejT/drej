import urllib.request
import json


class DrejClient:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url.rstrip("/")

    def health(self) -> dict:
        with urllib.request.urlopen(f"{self.base_url}/health") as resp:
            return json.loads(resp.read())
