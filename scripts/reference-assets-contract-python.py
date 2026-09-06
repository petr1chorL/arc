"""Replay shared asset requests on synthetic SQLite; never load a .env file."""
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


def normalize(value, key=""):
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {field: normalize(item, field) for field, item in value.items()}
    if value is not None and key in {"id", "createdBy", "actorId", "providerId", "assetId", "targetId"}:
        return "<id>"
    if value is not None and key in {"createdAt", "updatedAt"}:
        return "<timestamp>"
    return value


def replay():
    cases = json.loads((ROOT / "fixtures/reference-assets-requests.json").read_text(encoding="utf-8"))
    with TemporaryDirectory(prefix="arc-assets-contract-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        results, ids = [], {}
        try:
            for case in cases:
                path = case["path"]
                for key, value in ids.items():
                    path = path.replace("{" + key + "}", value)
                kwargs = {"json": case["body"]} if "body" in case else {}
                response = client.request(case["method"], f"/api/workspaces/{workspace_id}{path}",
                                          headers=csrf_headers(client), **kwargs)
                assert response.status_code == case["status"], (case["name"], response.status_code, response.json())
                body = response.json()
                if "save" in case:
                    ids[case["save"]] = body["id"]
                results.append({"name": case["name"], "status": response.status_code, "body": normalize(body)})
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(replay(), ensure_ascii=True))
