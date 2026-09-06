"""Characterize the existing Agent API on disposable synthetic data, without external calls."""
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
from api_test_support import create_authenticated_client, csrf_headers
from app.agent_manifest import normalize_agent_runtime_manifest


def inspect():
    with TemporaryDirectory(prefix="arc-agent-contract-") as directory:
        client, workspace = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        base = f"/api/workspaces/{workspace}/agents"
        headers = csrf_headers(client)

        def create():
            response = client.post(base, headers=headers, json={
                "name": "Synthetic Agent", "role": "Contract verification", "owner": "Synthetic", "model": "test",
            })
            assert response.status_code == 201
            return response.json()

        try:
            agent = create()
            path = f"{base}/{agent['id']}"
            lifecycle = [{"step": "create", "state": agent["status"]}]
            for operation in ["publish", "deactivate", "activate"]:
                response = client.post(f"{path}/{operation}", headers=headers)
                assert response.status_code in {200, 201}
                persisted = client.get(path).json()
                lifecycle.append({"step": operation, "http": response.status_code, "state": persisted["status"],
                                  "snapshotState": response.json().get("snapshot", {}).get("status")})
            nulls = []
            for field in ["name", "role", "owner", "model", "modelProvider", "modelBaseUrl", "modelProviderId",
                          "temperature", "maxOutputTokens", "systemPrompt", "tools", "skills", "runtimeManifest"]:
                current = create()
                target = f"{base}/{current['id']}"
                try:
                    response = client.patch(target, headers=headers, json={field: None})
                    result = {"http": response.status_code}
                except Exception as error:
                    # Only report the class, never exception text/SQL/request content.
                    result = {"exception": type(error).__name__}
                after = client.get(target)
                assert after.status_code == 200
                nulls.append({"field": field, **result, "storedValueUnchanged": after.json()[field] == current[field]})
            provider = client.post(f"/api/workspaces/{workspace}/model-providers", headers=headers, json={
                "name": "Synthetic provider", "baseUrl": "https://models.example.invalid/v1",
                "defaultModel": "bound-model", "secretRef": "SYNTHETIC_KEY",
            })
            assert provider.status_code == 201
            binding = client.patch(path, headers=headers, json={"modelProviderId": provider.json()["id"]})
            assert binding.status_code == 200
            detached = client.patch(path, headers=headers, json={"modelProviderId": None})
            assert detached.status_code == 200
            binding_result = {"draftProviderAccepted": binding.json()["model"] == "bound-model",
                "nullDetaches": detached.json()["modelProviderId"] is None,
                "copiedConfigRetained": all(detached.json()[field] == binding.json()[field]
                                           for field in ["modelProvider", "modelBaseUrl", "model"])}
            urls = []
            for url in ["https://agent.example.invalid/run", "https://agent.example.invalid/run?",
                        "https://agent.example.invalid/run#", "https://2130706433/run",
                        "https://127.0.0.1/run", "https://user:synthetic@agent.example.invalid/run"]:
                try:
                    normalize_agent_runtime_manifest({"runtime": "remote_http", "sourceType": "remote_api",
                        "protocolVersion": "arc-agent-v1", "endpointUrl": url, "secretRef": "SYNTHETIC_KEY",
                        "timeoutSeconds": 30})
                    accepted = True
                except ValueError:
                    accepted = False
                urls.append({"url": url, "accepted": accepted})
            return {"lifecycle": lifecycle, "nullPatch": nulls, "providerBinding": binding_result,
                    "remoteUrlStructure": urls,
                    "scope": "synthetic SQLite; no execution endpoints or external calls"}
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(inspect(), ensure_ascii=True))
