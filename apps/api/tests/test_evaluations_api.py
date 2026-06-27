from api_test_support import create_authenticated_client, workspace_url


def test_evaluation_rubrics_are_workspace_assets_without_duplicate_seed(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")

    first_response = client.get(workspace_url(workspace_id, "/evaluations/rubrics"))
    second_response = client.get(workspace_url(workspace_id, "/evaluations/rubrics"))

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert len(first_payload) == 3
    assert [rubric["id"] for rubric in second_payload] == [
        rubric["id"] for rubric in first_payload
    ]
    assert first_payload[0]["id"]
    assert first_payload[0] | {"id": "<stable-in-this-workspace>"} == {
        "id": "<stable-in-this-workspace>",
        "name": "竞品分析质量标准",
        "artifact": "竞品分析矩阵",
        "dimensions": [
            {"name": "事实准确性", "weight": 25},
            {"name": "信息完整性", "weight": 20},
            {"name": "洞察价值", "weight": 25},
            {"name": "业务相关性", "weight": 15},
            {"name": "结构与复用", "weight": 10},
            {"name": "风险控制", "weight": 5},
        ],
        "gate": "来源完整率 = 100%，竞品数量 >= 5",
        "passScore": 85,
        "version": "v2.1",
        "status": "active",
    }
