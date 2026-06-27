from api_test_support import create_authenticated_client, csrf_headers, workspace_url


def test_regression_sample_sets_can_be_created_and_listed(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")

    created = client.post(
        workspace_url(workspace_id, "/evaluations/sample-sets"),
        json={
            "name": "Launch Readiness Golden Set",
            "description": "High-risk product launch examples",
        },
        headers=csrf_headers(client),
    )

    assert created.status_code == 201
    sample_set = created.json()
    assert sample_set["name"] == "Launch Readiness Golden Set"
    assert sample_set["description"] == "High-risk product launch examples"
    assert sample_set["status"] == "active"
    assert sample_set["sampleCount"] == 0
    assert sample_set["activeSampleCount"] == 0
    assert sample_set["samples"] == []

    sample = client.post(
        workspace_url(workspace_id, f"/evaluations/sample-sets/{sample_set['id']}/samples"),
        json={
            "name": "Evidence-rich launch plan",
            "input": "Customer interviews show outdoor usage needs waterproofing and long battery life.",
            "expectedOutput": "Must include scenario, evidence, constraints, and next experiment.",
            "tags": ["evidence", "launch"],
        },
        headers=csrf_headers(client),
    )

    assert sample.status_code == 201
    created_sample = sample.json()
    assert created_sample["sampleSetId"] == sample_set["id"]
    assert created_sample["status"] == "active"
    assert created_sample["tags"] == ["evidence", "launch"]

    listed = client.get(workspace_url(workspace_id, "/evaluations/sample-sets"))

    assert listed.status_code == 200
    listed_set = listed.json()[0]
    assert listed_set["id"] == sample_set["id"]
    assert listed_set["sampleCount"] == 1
    assert listed_set["activeSampleCount"] == 1
    assert listed_set["samples"][0]["input"] == (
        "Customer interviews show outdoor usage needs waterproofing and long battery life."
    )


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


def test_published_rubric_can_evaluate_artifact_and_list_records(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    rubric_body = {
        "name": "Launch Readiness Rubric",
        "artifact": "Launch plan",
        "dimensions": [
            {"name": "Evidence", "weight": 60},
            {"name": "Actionability", "weight": 40},
        ],
        "gate": "Must include source evidence and clear next actions",
        "passScore": 70,
    }
    created = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=rubric_body,
        headers=csrf_headers(client),
    )
    rubric = created.json()
    published = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    evaluated = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/evaluate"),
        json={
            "artifactText": (
                "This launch plan includes source evidence, owner, risks, "
                "clear next actions, and measurable acceptance criteria."
            ),
            "subjectType": "manual_artifact",
            "subjectId": "artifact-v0.9d",
        },
        headers=csrf_headers(client),
    )

    assert evaluated.status_code == 201
    record = evaluated.json()
    assert record["id"]
    assert record["rubricId"] == rubric["id"]
    assert record["rubricVersion"] == published["version"]
    assert record["rubricSnapshot"]["passScore"] == 70
    assert record["subjectType"] == "manual_artifact"
    assert record["subjectId"] == "artifact-v0.9d"
    assert record["status"] == "passed"
    assert record["score"] >= 70
    assert record["dimensionScores"] == [
        {"name": "Evidence", "weight": 60, "score": record["dimensionScores"][0]["score"]},
        {"name": "Actionability", "weight": 40, "score": record["dimensionScores"][1]["score"]},
    ]
    assert "deterministic" in record["rationale"]

    records = client.get(workspace_url(workspace_id, "/evaluations/records"))
    assert records.status_code == 200
    assert records.json()[0]["id"] == record["id"]


def test_draft_or_disabled_rubric_cannot_run_evaluation(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    rubric_body = {
        "name": "Draft Rubric",
        "artifact": "Draft artifact",
        "dimensions": [{"name": "Completeness", "weight": 100}],
        "gate": "Must be complete",
        "passScore": 80,
    }
    rubric = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=rubric_body,
        headers=csrf_headers(client),
    ).json()

    draft_response = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/evaluate"),
        json={"artifactText": "Short draft", "subjectType": "manual_artifact"},
        headers=csrf_headers(client),
    )

    assert draft_response.status_code == 409

    client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/deactivate"),
        headers=csrf_headers(client),
    )
    disabled_response = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/evaluate"),
        json={"artifactText": "Short draft", "subjectType": "manual_artifact"},
        headers=csrf_headers(client),
    )

    assert disabled_response.status_code == 409
