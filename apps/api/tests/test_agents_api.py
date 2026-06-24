from fastapi.testclient import TestClient
from uuid import UUID

from app.main import create_app


def test_create_agent_rejects_blank_name(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client = TestClient(create_app(database_url))

    response = client.post(
        "/api/agents",
        json={
            "name": " ",
            "role": "汇总访谈并提炼用户需求",
            "owner": "产品创新组",
            "model": "GPT-5",
        },
    )

    assert response.status_code == 422


def test_create_agent_persists_and_lists_complete_contract(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client = TestClient(create_app(database_url))
    payload = {
        "name": "用户洞察 Agent",
        "role": "汇总访谈并提炼用户需求",
        "owner": "产品创新组",
        "model": "GPT-5",
    }

    create_response = client.post("/api/agents", json=payload)

    assert create_response.status_code == 201
    created = create_response.json()
    UUID(created["id"])
    assert created == {
        **payload,
        "id": created["id"],
        "status": "调试中",
        "version": "v0.1.0",
        "passRate": 0,
        "runs": 0,
        "tools": [],
        "skills": [],
        "systemPrompt": "",
        "createdAt": created["createdAt"],
        "updatedAt": created["updatedAt"],
    }
    assert created["createdAt"] == created["updatedAt"]

    list_response = client.get("/api/agents")

    assert list_response.status_code == 200
    assert list_response.json() == [created]


def test_agent_survives_application_restart(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    payload = {
        "name": "重启验证 Agent",
        "role": "验证服务重启后的数据持久性",
        "owner": "平台工程组",
        "model": "GPT-5",
    }
    first_client = TestClient(create_app(database_url))
    created = first_client.post("/api/agents", json=payload).json()
    first_client.close()

    restarted_client = TestClient(create_app(database_url))
    agents = restarted_client.get("/api/agents").json()

    assert agents == [created]
