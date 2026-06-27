from api_test_support import create_authenticated_client, csrf_headers, workspace_url


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


def test_rubric_draft_can_be_edited_published_and_deactivated(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    body = {
        "name": "新品定义 Rubric",
        "artifact": "产品定义草案",
        "dimensions": [
            {"name": "用户价值", "weight": 60},
            {"name": "商业可行性", "weight": 40},
        ],
        "gate": "必须包含目标用户、场景和约束",
        "passScore": 82,
    }

    created = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=body,
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    rubric = created.json()
    assert rubric["status"] == "draft"
    assert rubric["version"] == "v0.1.0"

    updated = client.patch(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}"),
        json={**body, "passScore": 88},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["passScore"] == 88

    published = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    version = published.json()
    assert version["version"] == "v1.0.0"
    assert version["snapshot"]["passScore"] == 88

    client.patch(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}"),
        json={**body, "passScore": 75},
        headers=csrf_headers(client),
    )
    versions = client.get(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/versions"),
    )
    assert versions.status_code == 200
    assert versions.json()[0]["snapshot"]["passScore"] == 88

    deactivated = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/deactivate"),
        headers=csrf_headers(client),
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "disabled"

    rejected_update = client.patch(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}"),
        json=body,
        headers=csrf_headers(client),
    )
    assert rejected_update.status_code == 409


def test_rubric_validation_rejects_invalid_weights_and_blank_fields(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")

    response = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json={
            "name": "  ",
            "artifact": "产品定义草案",
            "dimensions": [
                {"name": "用户价值", "weight": 60},
                {"name": "商业可行性", "weight": 30},
            ],
            "gate": "  ",
            "passScore": 101,
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
