from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.judge_gateway import JudgeGatewayResult


class FakeJudgeGateway:
    def __init__(self, results: list[JudgeGatewayResult]):
        self.results = results
        self.calls: list[dict] = []

    def evaluate(self, **request) -> JudgeGatewayResult:
        self.calls.append(request)
        return self.results.pop(0)


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


def test_regression_run_persists_batch_summary_and_evaluations(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    rubric_body = {
        "name": "Regression Run Rubric",
        "artifact": "Launch plan",
        "dimensions": [
            {"name": "Evidence", "weight": 60},
            {"name": "Actionability", "weight": 40},
        ],
        "gate": "Must include evidence and next actions",
        "passScore": 70,
    }
    rubric = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=rubric_body,
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    sample_set = client.post(
        workspace_url(workspace_id, "/evaluations/sample-sets"),
        json={
            "name": "Launch Regression Set",
            "description": "Samples for release quality",
        },
        headers=csrf_headers(client),
    ).json()
    first_sample = client.post(
        workspace_url(workspace_id, f"/evaluations/sample-sets/{sample_set['id']}/samples"),
        json={
            "name": "Evidence rich sample",
            "input": "This launch plan includes customer evidence, owner, risks, and next actions.",
            "expectedOutput": "Should pass because it has evidence and actionability.",
            "tags": ["pass"],
        },
        headers=csrf_headers(client),
    ).json()
    second_sample = client.post(
        workspace_url(workspace_id, f"/evaluations/sample-sets/{sample_set['id']}/samples"),
        json={
            "name": "Thin sample",
            "input": "Short draft.",
            "expectedOutput": "Should fail because it lacks evidence.",
            "tags": ["fail"],
        },
        headers=csrf_headers(client),
    ).json()

    created = client.post(
        workspace_url(workspace_id, "/evaluations/regression-runs"),
        json={
            "rubricId": rubric["id"],
            "sampleSetId": sample_set["id"],
        },
        headers=csrf_headers(client),
    )

    assert created.status_code == 201
    run = created.json()
    assert run["sampleSetId"] == sample_set["id"]
    assert run["sampleSetName"] == "Launch Regression Set"
    assert run["rubricId"] == rubric["id"]
    assert run["rubricName"] == "Regression Run Rubric"
    assert run["status"] == "completed"
    assert run["totalSamples"] == 2
    assert run["passedSamples"] == 1
    assert run["failedSamples"] == 1
    assert run["passRate"] == 50
    assert len(run["evaluationIds"]) == 2
    assert [record["subjectId"] for record in run["records"]] == [
        first_sample["id"],
        second_sample["id"],
    ]
    assert {record["subjectType"] for record in run["records"]} == {"regression_run_sample"}

    listed = client.get(workspace_url(workspace_id, "/evaluations/regression-runs"))

    assert listed.status_code == 200
    assert listed.json()[0]["id"] == run["id"]
    assert listed.json()[0]["totalSamples"] == 2
    assert listed.json()[0]["evaluationIds"] == run["evaluationIds"]


def test_regression_run_detail_returns_associated_evaluations(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    rubric = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json={
            "name": "Run Detail Rubric",
            "artifact": "Launch plan",
            "dimensions": [{"name": "Evidence", "weight": 100}],
            "gate": "Must include evidence",
            "passScore": 70,
        },
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    created_run = client.post(
        workspace_url(workspace_id, "/evaluations/regression-runs"),
        json={
            "rubricId": rubric["id"],
            "samples": [
                {
                    "sampleId": "manual-pass",
                    "input": "Evidence-backed plan with owner, risk, and next action.",
                },
                {
                    "sampleId": "manual-fail",
                    "input": "Thin draft.",
                },
            ],
        },
        headers=csrf_headers(client),
    ).json()

    detail = client.get(
        workspace_url(workspace_id, f"/evaluations/regression-runs/{created_run['id']}"),
    )

    assert detail.status_code == 200
    run = detail.json()
    assert run["id"] == created_run["id"]
    assert run["rubricId"] == rubric["id"]
    assert run["sampleSetId"] is None
    assert run["sampleSetName"] == "手动样本"
    assert run["totalSamples"] == 2
    assert run["evaluationIds"] == created_run["evaluationIds"]
    assert [record["id"] for record in run["records"]] == created_run["evaluationIds"]
    assert [record["subjectId"] for record in run["records"]] == ["manual-pass", "manual-fail"]
    assert run["records"][0]["artifactText"] == (
        "Evidence-backed plan with owner, risk, and next action."
    )


def test_regression_run_detail_returns_404_for_unknown_run(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")

    detail = client.get(workspace_url(workspace_id, "/evaluations/regression-runs/missing-run"))

    assert detail.status_code == 404


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
        "judgeType": "deterministic",
        "judgeModel": "",
        "version": "v2.1",
        "status": "active",
    }


def test_remediation_tasks_can_be_created_listed_and_updated(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    payload = {
        "sourceRunId": "run-remediation-1",
        "clusterKey": "Evidence",
        "title": "修复 Evidence 偏低",
        "priority": "P1",
        "sampleIds": ["sample-a", "sample-b"],
        "action": "优先补齐 Evidence 相关证据与判定依据",
    }

    created = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json=payload,
        headers=csrf_headers(client),
    )

    assert created.status_code == 201
    task = created.json()
    assert task["sourceRunId"] == "run-remediation-1"
    assert task["clusterKey"] == "Evidence"
    assert task["title"] == "修复 Evidence 偏低"
    assert task["priority"] == "P1"
    assert task["sampleIds"] == ["sample-a", "sample-b"]
    assert task["action"] == "优先补齐 Evidence 相关证据与判定依据"
    assert task["status"] == "open"

    duplicate = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json=payload,
        headers=csrf_headers(client),
    )

    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == task["id"]

    listed = client.get(workspace_url(workspace_id, "/evaluations/remediation-tasks"))

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [task["id"]]

    in_progress = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task['id']}"),
        json={"status": "in_progress"},
        headers=csrf_headers(client),
    )

    assert in_progress.status_code == 200
    assert in_progress.json()["status"] == "in_progress"

    done = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task['id']}"),
        json={"status": "done"},
        headers=csrf_headers(client),
    )

    assert done.status_code == 200
    assert done.json()["status"] == "done"


def test_remediation_tasks_support_owner_due_date_and_filters(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    overdue_payload = {
        "sourceRunId": "run-remediation-owner-1",
        "clusterKey": "Evidence",
        "title": "修复 Evidence 偏低",
        "priority": "P1",
        "sampleIds": ["sample-a"],
        "action": "补齐证据",
        "owner": "产品审核人",
        "dueDate": "2024-01-01T00:00:00Z",
    }
    future_payload = {
        "sourceRunId": "run-remediation-owner-2",
        "clusterKey": "Actionability",
        "title": "修复 Actionability 偏低",
        "priority": "P2",
        "sampleIds": ["sample-b"],
        "action": "补齐行动建议",
        "owner": "算法审核人",
        "dueDate": "2099-01-01T00:00:00Z",
    }

    overdue = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json=overdue_payload,
        headers=csrf_headers(client),
    )
    future = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json=future_payload,
        headers=csrf_headers(client),
    )

    assert overdue.status_code == 201
    assert future.status_code == 201
    assert overdue.json()["owner"] == "产品审核人"
    assert overdue.json()["dueDate"].startswith("2024-01-01T00:00:00")
    assert overdue.json()["isOverdue"] is True
    assert future.json()["isOverdue"] is False

    by_owner = client.get(
        workspace_url(workspace_id, "/evaluations/remediation-tasks?owner=产品审核人"),
    )
    assert by_owner.status_code == 200
    assert [item["title"] for item in by_owner.json()] == ["修复 Evidence 偏低"]

    by_priority = client.get(
        workspace_url(workspace_id, "/evaluations/remediation-tasks?priority=P2"),
    )
    assert by_priority.status_code == 200
    assert [item["title"] for item in by_priority.json()] == ["修复 Actionability 偏低"]

    overdue_only = client.get(
        workspace_url(workspace_id, "/evaluations/remediation-tasks?overdue=true"),
    )
    assert overdue_only.status_code == 200
    assert [item["title"] for item in overdue_only.json()] == ["修复 Evidence 偏低"]


def test_remediation_task_metadata_can_be_updated(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    created = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json={
            "sourceRunId": "run-remediation-metadata",
            "clusterKey": "Evidence",
            "title": "修复 Evidence 偏低",
            "priority": "P1",
            "sampleIds": ["sample-a"],
            "action": "补齐证据",
            "owner": "产品审核人",
            "dueDate": "2024-01-01T00:00:00Z",
        },
        headers=csrf_headers(client),
    )
    task_id = created.json()["id"]

    updated = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task_id}"),
        json={
            "owner": "质量负责人",
            "priority": "P0",
            "dueDate": "2024-01-05T00:00:00Z",
        },
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    body = updated.json()
    assert body["owner"] == "质量负责人"
    assert body["priority"] == "P0"
    assert body["dueDate"].startswith("2024-01-05T00:00:00")
    assert body["activities"][-1]["kind"] == "metadata_change"
    assert "负责人 产品审核人 -> 质量负责人" in body["activities"][-1]["body"]
    assert "优先级 P1 -> P0" in body["activities"][-1]["body"]
    assert "截止 2024-01-01 -> 2024-01-05" in body["activities"][-1]["body"]

    listed = client.get(workspace_url(workspace_id, "/evaluations/remediation-tasks?owner=质量负责人"))
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == task_id

    cleared = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task_id}"),
        json={"owner": "", "dueDate": None},
        headers=csrf_headers(client),
    )
    assert cleared.status_code == 200
    assert cleared.json()["owner"] is None
    assert cleared.json()["dueDate"] is None

    empty = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task_id}"),
        json={},
        headers=csrf_headers(client),
    )
    assert empty.status_code == 422


def test_remediation_task_activities_record_comments_and_status_changes(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    task = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json={
            "sourceRunId": "run-remediation-activity-1",
            "clusterKey": "Evidence",
            "title": "修复 Evidence 偏低",
            "priority": "P1",
            "sampleIds": ["sample-a"],
            "action": "补齐证据",
            "owner": "产品审核人",
            "dueDate": "2099-01-01T00:00:00Z",
        },
        headers=csrf_headers(client),
    ).json()

    comment = client.post(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task['id']}/activities"),
        json={
            "body": "已补充竞品来源和截图证据",
            "attachmentRefs": ["lark://doc/evidence-note", "drive://artifact/screenshot-1"],
        },
        headers=csrf_headers(client),
    )

    assert comment.status_code == 201
    created_comment = comment.json()
    assert created_comment["kind"] == "comment"
    assert created_comment["body"] == "已补充竞品来源和截图证据"
    assert created_comment["attachmentRefs"] == ["lark://doc/evidence-note", "drive://artifact/screenshot-1"]
    assert created_comment["actorDisplayName"] == "Organization Admin"

    updated = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{task['id']}"),
        json={"status": "in_progress"},
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    activities = updated.json()["activities"]
    assert [activity["kind"] for activity in activities] == ["comment", "status_change"]
    assert activities[0]["body"] == "已补充竞品来源和截图证据"
    assert activities[1]["body"] == "状态变更：open -> in_progress"

    listed = client.get(workspace_url(workspace_id, "/evaluations/remediation-tasks"))

    assert listed.status_code == 200
    listed_task = listed.json()[0]
    assert listed_task["activities"][0]["attachmentRefs"] == [
        "lark://doc/evidence-note",
        "drive://artifact/screenshot-1",
    ]
    assert listed_task["activities"][1]["kind"] == "status_change"


def test_failed_remediation_retest_reopens_task_and_can_be_retested_again(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'arc-one.db'}")
    rubric = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json={
            "name": "Remediation Retest Rubric",
            "artifact": "Launch plan",
            "dimensions": [{"name": "Evidence", "weight": 100}],
            "gate": "Must include evidence",
            "passScore": 70,
        },
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    source_run = client.post(
        workspace_url(workspace_id, "/evaluations/regression-runs"),
        json={
            "rubricId": rubric["id"],
            "samples": [
                {
                    "sampleId": "sample-pass",
                    "input": "Evidence-backed plan with owner, risk, and next action.",
                },
                {
                    "sampleId": "sample-fail",
                    "input": "Thin draft.",
                },
            ],
        },
        headers=csrf_headers(client),
    ).json()
    created = client.post(
        workspace_url(workspace_id, "/evaluations/remediation-tasks"),
        json={
            "sourceRunId": source_run["id"],
            "clusterKey": "Evidence",
            "title": "修复 Evidence 偏低",
            "priority": "P1",
            "sampleIds": ["sample-fail"],
            "action": "补齐 Evidence 后复测",
        },
        headers=csrf_headers(client),
    ).json()

    blocked = client.post(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}/retest"),
        headers=csrf_headers(client),
    )

    assert blocked.status_code == 409

    client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}"),
        json={"status": "done"},
        headers=csrf_headers(client),
    )

    retested = client.post(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}/retest"),
        headers=csrf_headers(client),
    )

    assert retested.status_code == 201
    task = retested.json()
    assert task["status"] == "in_progress"
    assert task["retestRunId"]
    assert task["retestRun"]["id"] == task["retestRunId"]
    assert task["retestRun"]["rubricId"] == rubric["id"]
    assert task["retestRun"]["totalSamples"] == 1
    assert task["retestRun"]["failedSamples"] == 1
    assert task["retestRun"]["records"][0]["subjectId"] == "sample-fail"
    assert task["retestRun"]["records"][0]["artifactText"] == "Thin draft."
    assert [activity["kind"] for activity in task["activities"]][-2:] == [
        "retest_failed",
        "status_change",
    ]
    assert task["activities"][-2]["body"] == "复测未通过：1 条样本失败，任务已回流"
    assert task["activities"][-1]["body"] == "状态变更：done -> in_progress"

    listed_tasks = client.get(workspace_url(workspace_id, "/evaluations/remediation-tasks"))
    assert listed_tasks.status_code == 200
    listed_task = listed_tasks.json()[0]
    assert listed_task["status"] == "in_progress"
    assert listed_task["retestRunId"] == task["retestRunId"]
    assert listed_task["retestRun"]["failedSamples"] == 1
    assert listed_task["activities"][-2]["kind"] == "retest_failed"

    repeated = client.post(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}/retest"),
        headers=csrf_headers(client),
    )

    assert repeated.status_code == 409

    completed_again = client.patch(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}"),
        json={"status": "done"},
        headers=csrf_headers(client),
    )

    assert completed_again.status_code == 200
    assert completed_again.json()["status"] == "done"
    assert completed_again.json()["retestRunId"] is None

    retested_again = client.post(
        workspace_url(workspace_id, f"/evaluations/remediation-tasks/{created['id']}/retest"),
        headers=csrf_headers(client),
    )

    assert retested_again.status_code == 201
    assert retested_again.json()["retestRunId"] != task["retestRunId"]
    listed = client.get(workspace_url(workspace_id, "/evaluations/regression-runs"))
    assert len([run for run in listed.json() if run["sampleSetName"] == "修复复测"]) == 2


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


def test_llm_judge_rubric_evaluation_records_model_and_input_snapshot(tmp_path):
    gateway = FakeJudgeGateway([
        JudgeGatewayResult(
            dimension_scores=[
                {"name": "Evidence", "weight": 60, "score": 91},
                {"name": "Actionability", "weight": 40, "score": 83},
            ],
            score=88,
            status="passed",
            rationale="llm judge: evidence is strong and actions are clear.",
            model="deepseek-v4-pro",
            input_snapshot={
                "artifactText": "Evidence-backed plan with owner and next action.",
                "rubricVersion": "v1.0",
            },
        ),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'llm-judge.db'}",
        judge_gateway=gateway,
    )
    rubric = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json={
            "name": "LLM Judge Rubric",
            "artifact": "Launch plan",
            "dimensions": [
                {"name": "Evidence", "weight": 60},
                {"name": "Actionability", "weight": 40},
            ],
            "gate": "Must include evidence and next actions",
            "passScore": 80,
            "judgeType": "llm",
            "judgeModel": "deepseek-v4-pro",
        },
        headers=csrf_headers(client),
    ).json()
    published = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    evaluated = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/evaluate"),
        json={
            "artifactText": "Evidence-backed plan with owner and next action.",
            "subjectType": "manual",
            "subjectId": "llm-sample-1",
        },
        headers=csrf_headers(client),
    )

    assert evaluated.status_code == 201
    record = evaluated.json()
    assert record["score"] == 88
    assert record["status"] == "passed"
    assert record["rationale"].startswith("llm judge")
    assert record["evaluatorType"] == "llm"
    assert record["evaluatorModel"] == "deepseek-v4-pro"
    assert record["evaluatorInput"]["artifactText"] == (
        "Evidence-backed plan with owner and next action."
    )
    assert record["dimensionScores"] == [
        {"name": "Evidence", "weight": 60, "score": 91},
        {"name": "Actionability", "weight": 40, "score": 83},
    ]
    assert gateway.calls[0]["rubric_snapshot"]["judgeType"] == "llm"
    assert gateway.calls[0]["rubric_version"] == published["version"]


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
