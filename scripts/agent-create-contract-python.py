"""Replay supplied synthetic Agent create bodies on SQLite without loading .env."""
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
    with TemporaryDirectory(prefix="arc-agent-contract-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        try:
            results = []
            for case in fixture["cases"]:
                response = client.post(f"/api/workspaces/{workspace_id}/agents",
                    headers=csrf_headers(client), json={**fixture["base"], **case["patch"]})
                result = {"name": case["name"], "status": response.status_code, "body": response.json()}
                if "followUps" in case:
                    result["followUps"] = []
                    for follow_up in case["followUps"]:
                        follow_response = client.request(follow_up["method"],
                            f"/api/workspaces/{workspace_id}/agents/{result['body']['id']}{follow_up['suffix']}",
                            headers=csrf_headers(client),
                            **({"json": follow_up["body"]} if "body" in follow_up else {}))
                        result["followUps"].append({"status": follow_response.status_code, "body": follow_response.json()})
                results.append(result)
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(replay(json.load(sys.stdin)), ensure_ascii=True))
