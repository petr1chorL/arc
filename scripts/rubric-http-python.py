"""Replay synthetic rubric governance HTTP requests without importing .env settings."""
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
from app.config import Settings

Settings.model_config["env_file"] = None
from api_test_support import create_authenticated_client, csrf_headers, workspace_url


def replay(cases):
    with TemporaryDirectory(prefix="arc-rubric-http-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        try:
            provider = client.post(workspace_url(workspace_id, "/model-providers"), headers=csrf_headers(client), json={
                "name": "Shared rubric provider", "baseUrl": "https://model.example.invalid", "defaultModel": "synthetic",
                "secretRef": "SYNTHETIC_KEY"})
            assert provider.status_code == 201

            def resolve(value):
                if isinstance(value, dict):
                    return {key: resolve(item) for key, item in value.items()}
                if isinstance(value, list):
                    return [resolve(item) for item in value]
                return provider.json()["id"] if value == "@provider" else value

            base = workspace_url(workspace_id, "/evaluations/rubrics")
            results = []
            for case in cases:
                response = client.post(base, headers=csrf_headers(client), json=resolve(case["body"]))
                assert response.status_code == case["status"], case["name"]
                result = {"status": response.status_code, "body": response.json(), "steps": []}
                for step in case.get("steps", []):
                    follow = client.request(step["method"], f"{base}/{result['body']['id']}{step['suffix']}",
                        headers=csrf_headers(client), **({"json": resolve(step["body"])} if "body" in step else {}))
                    assert follow.status_code == step["status"], (case["name"], step["suffix"], follow.status_code)
                    result["steps"].append({"status": follow.status_code, "body": follow.json()})
                results.append(result)
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(replay(json.loads(sys.stdin.buffer.read().decode("utf-8"))), ensure_ascii=True))
