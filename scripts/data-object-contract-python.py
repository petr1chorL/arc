"""Replay synthetic JSON requests against the actual Python API, without .env."""
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
os.environ["MODEL_API_KEY"] = ""
from app.config import Settings

Settings.model_config["env_file"] = None
from api_test_support import create_authenticated_client, csrf_headers


def replay(fixture):
    with TemporaryDirectory(prefix="arc-data-object-contract-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        try:
            base = f"/api/workspaces/{workspace_id}/data-objects"
            results = []
            for case in fixture["cases"]:
                response = client.post(base, headers=csrf_headers(client), json=case["body"])
                result = {"name": case["name"], "status": response.status_code, "body": response.json()}
                if "followUps" in case:
                    result["followUps"] = []
                    for step in case["followUps"]:
                        path = base if step.get("root") else f"{base}/{result['body']['id']}{step['suffix']}"
                        follow = client.request(step["method"], path, headers=csrf_headers(client),
                                                **({"json": step["body"]} if "body" in step else {}))
                        result["followUps"].append({"status": follow.status_code, "body": follow.json()})
                results.append(result)
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(replay(json.loads(sys.stdin.buffer.read().decode("utf-8"))), ensure_ascii=True))
