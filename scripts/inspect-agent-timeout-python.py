"""Inspect literal JSON timeout compatibility using synthetic local HTTP requests."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location("agent_create_replay", Path(__file__).with_name("agent-create-contract-python.py"))
replay_module = module_from_spec(spec)
spec.loader.exec_module(replay_module)


def main():
    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="arc-timeout-contract-") as directory:
        client, workspace_id = replay_module.create_authenticated_client(f"sqlite:///{Path(directory) / 'test.db'}")
        try:
            results = []
            for literal in ("30", "30.0", "3e1", "30.5", "true", '"30"', "0", "61"):
                body = '{"name":"Synthetic","role":"Test","owner":"Test","model":"test",' \
                       '"runtimeManifest":{"runtime":"remote_http","sourceType":"remote_api",' \
                       '"protocolVersion":"arc-agent-v1","endpointUrl":"https://agent.example.invalid/run",' \
                       '"secretRef":"SYNTHETIC_KEY","timeoutSeconds":' + literal + '}}'
                response = client.post(f"/api/workspaces/{workspace_id}/agents", content=body.encode("utf-8"),
                    headers={**replay_module.csrf_headers(client), "Content-Type": "application/json"})
                expected = 201 if literal in ("30", "30.0", "3e1") else 422
                assert response.status_code == expected, f"{literal}: expected {expected}, received {response.status_code}"
                if expected == 201:
                    from app.models import AgentRecord
                    with client.app.state.session_factory() as session:
                        stored = session.get(AgentRecord, response.json()["id"])
                        assert type(stored.runtime_manifest["timeoutSeconds"]) is int
                        assert stored.runtime_manifest["timeoutSeconds"] == 30
                results.append({"literal": literal, "status": response.status_code})
            print(json.dumps(results))
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    main()
