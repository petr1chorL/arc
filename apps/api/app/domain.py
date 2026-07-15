from collections import deque

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AgentVersionRecord,
    DataObjectDefinitionRecord,
    DataObjectVersionRecord,
    ModelProviderRecord,
    ReviewGroupMemberRecord,
    ReviewGroupRecord,
    RubricRecord,
    RubricVersionRecord,
)
from app.runtime_security import is_valid_model_secret_ref


def next_version(existing_count: int) -> str:
    return "v1.0.0" if existing_count == 0 else f"v1.{existing_count}.0"


def topological_order(nodes: list[dict], edges: list[dict]) -> list[str]:
    node_ids = {node["id"] for node in nodes}
    adjacency = {node_id: [] for node_id in node_ids}
    indegree = {node_id: 0 for node_id in node_ids}
    for edge in edges:
        if edge["source"] in node_ids and edge["target"] in node_ids:
            adjacency[edge["source"]].append(edge["target"])
            indegree[edge["target"]] += 1
    queue = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    ordered: list[str] = []
    while queue:
        current = queue.popleft()
        ordered.append(current)
        for target in adjacency[current]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if len(ordered) != len(node_ids):
        raise ValueError("工作流不能包含有向环")
    return ordered


def validate_workflow(
    nodes: list[dict],
    edges: list[dict],
    session: Session,
    workspace_id: str | None = None,
) -> list[str]:
    errors: list[str] = []
    node_ids = [node["id"] for node in nodes]
    node_id_set = set(node_ids)

    if len(node_ids) != len(node_id_set):
        errors.append("节点 ID 必须唯一")
    if not any(node["type"] == "trigger" for node in nodes):
        errors.append("工作流至少需要一个触发节点")
    if not any(node["type"] == "end" for node in nodes):
        errors.append("工作流至少需要一个结束节点")

    adjacency = {node_id: [] for node_id in node_id_set}
    indegree = {node_id: 0 for node_id in node_id_set}
    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        if source not in node_id_set or target not in node_id_set:
            errors.append(f"连线 {edge['id']} 引用了不存在的节点")
            continue
        if source == target:
            errors.append(f"节点 {source} 不允许自环")
        adjacency[source].append(target)
        indegree[target] += 1
    incoming_edge_counts = indegree.copy()

    queue = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        current = queue.popleft()
        visited += 1
        for target in adjacency[current]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if node_id_set and visited != len(node_id_set):
        errors.append("工作流不能包含有向环")

    def validate_data_object_ref(node: dict, field: str, label: str) -> None:
        if not workspace_id:
            return
        data = node.get("data", {})
        ref = data.get(field)
        if not ref:
            return
        if not isinstance(ref, dict):
            errors.append(f"节点 {node['id']} 的{label} Data Object 引用格式无效")
            return
        definition_id = ref.get("definitionId")
        if not definition_id:
            errors.append(f"节点 {node['id']} 的{label} Data Object 必须包含 Definition ID")
            return
        definition = session.scalar(
            select(DataObjectDefinitionRecord).where(
                DataObjectDefinitionRecord.id == definition_id,
                DataObjectDefinitionRecord.workspace_id == workspace_id,
            ),
        )
        if definition is None:
            errors.append(f"节点 {node['id']} 的{label} Data Object {definition_id} 不存在")
            return
        if definition.status != "published" or definition.version == "unpublished":
            errors.append(f"节点 {node['id']} 的{label} Data Object {definition.name} 尚未发布")
            return
        version = ref.get("version")
        if not version or version == "unpublished":
            errors.append(f"节点 {node['id']} 的{label} Data Object 必须绑定已发布版本")
            return
        version_record = session.scalar(
            select(DataObjectVersionRecord).where(
                DataObjectVersionRecord.workspace_id == workspace_id,
                DataObjectVersionRecord.definition_id == definition_id,
                DataObjectVersionRecord.version == version,
            ),
        )
        if version_record is None:
            errors.append(f"节点 {node['id']} 的{label} Data Object 版本 {version} 不存在")

    for node in nodes:
        validate_data_object_ref(node, "inputDataObjectRef", "输入")
        validate_data_object_ref(node, "outputDataObjectRef", "输出")
        if node["type"] == "evaluation":
            node_id = node["id"]
            if incoming_edge_counts.get(node_id, 0) != 1:
                errors.append(f"评估节点 {node_id} 必须恰好有 1 条入边")

            data = node.get("data")
            rubric_ref = data.get("rubricRef") if isinstance(data, dict) else None
            required_ref_fields = ("rubricId", "versionId", "version", "name")
            if not isinstance(rubric_ref, dict) or any(
                not isinstance(rubric_ref.get(field), str)
                or not rubric_ref[field].strip()
                for field in required_ref_fields
            ):
                errors.append(f"评估节点 {node_id} 必须选择已发布评估模板版本")
                continue

            rubric_id = rubric_ref["rubricId"].strip()
            version_id = rubric_ref["versionId"].strip()
            version = rubric_ref["version"].strip()
            rubric = session.scalar(
                select(RubricRecord).where(
                    RubricRecord.id == rubric_id,
                    RubricRecord.workspace_id == workspace_id,
                ),
            )
            if rubric is None:
                errors.append(f"评估节点 {node_id} 的评分模板版本不存在")
                continue
            if rubric.status != "active":
                errors.append(f"评估节点 {node_id} 的评分模板不可用")
                continue

            rubric_version = session.scalar(
                select(RubricVersionRecord).where(
                    RubricVersionRecord.id == version_id,
                    RubricVersionRecord.workspace_id == workspace_id,
                    RubricVersionRecord.rubric_id == rubric_id,
                    RubricVersionRecord.version == version,
                ),
            )
            if rubric_version is None:
                errors.append(f"评估节点 {node_id} 的评分模板版本不存在")
                continue

            snapshot = rubric_version.snapshot
            judge_type = None
            judge_model = None
            provider_id = None
            dimensions = None
            if isinstance(snapshot, dict):
                judge_type = snapshot.get("judgeType", snapshot.get("judge_type"))
                judge_model = snapshot.get("judgeModel", snapshot.get("judge_model"))
                provider_id = snapshot.get(
                    "modelProviderId",
                    snapshot.get("model_provider_id"),
                )
                dimensions = snapshot.get("dimensions")

            dimension_ids: set[str] = set()
            dimension_names: set[str] = set()
            total_weight = 0
            dimensions_valid = isinstance(dimensions, list) and bool(dimensions)
            if dimensions_valid:
                for dimension in dimensions:
                    if not isinstance(dimension, dict):
                        dimensions_valid = False
                        break
                    dimension_id = str(dimension.get("id") or "").strip()
                    dimension_name = str(dimension.get("name") or "").strip()
                    criteria = str(dimension.get("criteria") or "").strip()
                    weight = dimension.get("weight")
                    normalized_id = dimension_id.casefold()
                    normalized_name = dimension_name.casefold()
                    if (
                        not dimension_id
                        or not dimension_name
                        or not criteria
                        or normalized_id in dimension_ids
                        or normalized_name in dimension_names
                        or isinstance(weight, bool)
                        or not isinstance(weight, int)
                        or not 1 <= weight <= 100
                    ):
                        dimensions_valid = False
                        break
                    dimension_ids.add(normalized_id)
                    dimension_names.add(normalized_name)
                    total_weight += weight
                dimensions_valid = dimensions_valid and total_weight == 100

            if (
                judge_type != "llm"
                or not isinstance(judge_model, str)
                or not judge_model.strip()
                or not isinstance(provider_id, str)
                or not provider_id.strip()
                or not dimensions_valid
            ):
                errors.append(
                    f"评估节点 {node_id} 的评分模板版本不兼容工作流评估"
                )
                continue

            provider = session.scalar(
                select(ModelProviderRecord).where(
                    ModelProviderRecord.id == provider_id.strip(),
                    ModelProviderRecord.workspace_id == workspace_id,
                ),
            )
            if provider is None or provider.status == "disabled":
                errors.append(f"评估节点 {node_id} 的模型 Provider 不可用")
                continue
            required_provider_values = (
                provider.provider_type,
                provider.base_url,
                provider.default_model,
                provider.secret_ref,
            )
            if any(
                not isinstance(value, str) or not value.strip()
                for value in required_provider_values
            ) or not is_valid_model_secret_ref(provider.secret_ref.strip()):
                errors.append(f"评估节点 {node_id} 的模型 Provider 配置不完整")
            continue

        if node["type"] == "agent":
            retry_max_attempts = node["data"].get("retryMaxAttempts", 2)
            if (
                type(retry_max_attempts) is not int
                or not 1 <= retry_max_attempts <= 3
            ):
                errors.append(f"Agent 节点 {node['id']} 的重试次数必须是 1–3 的整数")
            agent_id = node["data"].get("agentId")
            agent_version = node["data"].get("agentVersion")
            if not agent_id or not agent_version:
                errors.append(f"Agent 节点 {node['id']} 必须选择已发布版本")
                continue
            statement = select(AgentVersionRecord).where(
                AgentVersionRecord.workspace_id == workspace_id,
                AgentVersionRecord.agent_id == agent_id,
                AgentVersionRecord.version == agent_version,
            )
            if session.scalar(statement) is None:
                errors.append(f"Agent 版本 {agent_id}@{agent_version} 不存在")
            continue

        if node["type"] != "human":
            continue
        data = node["data"]
        assignment_type = data.get("assignmentType", "group_claim")
        reviewer_ids = data.get("reviewerIds", [])
        group_id = data.get("groupId")
        if not reviewer_ids and not group_id:
            default_group = session.scalar(
                select(ReviewGroupRecord)
                .where(ReviewGroupRecord.is_escalation_group.is_(False))
                .order_by(ReviewGroupRecord.created_at.asc()),
            )
            group_id = default_group.id if default_group else None
        direct_assignment_types = {"direct", "direct_reviewer"}
        if assignment_type not in {*direct_assignment_types, "group_claim", "round_robin"}:
            errors.append(f"Human 节点 {node['id']} 的分配方式无效")
        if assignment_type in direct_assignment_types and not reviewer_ids:
            errors.append(f"Human 节点 {node['id']} 直接分配必须选择审核人")
        if assignment_type == "round_robin" and not group_id:
            errors.append(f"Human 节点 {node['id']} 轮询分配必须选择审核组")

        review_policy = data.get("reviewPolicy", "any_one")
        required_approvals = int(data.get("requiredApprovals", 1))
        participant_count = len(reviewer_ids)
        if assignment_type not in direct_assignment_types and group_id:
            participant_count = session.scalar(
                select(func.count())
                .select_from(ReviewGroupMemberRecord)
                .where(ReviewGroupMemberRecord.group_id == group_id),
            ) or 0
        if review_policy == "threshold":
            if required_approvals <= 0:
                errors.append(f"Human 节点 {node['id']} 的通过人数必须大于 0")
            if required_approvals > participant_count:
                errors.append(
                    f"Human 节点 {node['id']} 的通过人数不能超过参与审核人数"
                )

        due_minutes = int(data.get("dueMinutes", 240))
        escalation_minutes = int(data.get("escalationMinutes", 480))
        if due_minutes <= 0:
            errors.append(f"Human 节点 {node['id']} 的截止时间必须大于 0")
        if escalation_minutes <= due_minutes:
            errors.append(
                f"Human 节点 {node['id']} 的升级时间必须晚于截止时间"
            )

    return errors
