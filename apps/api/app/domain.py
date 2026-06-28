from collections import deque

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AgentVersionRecord,
    DataObjectDefinitionRecord,
    ReviewGroupMemberRecord,
    ReviewGroupRecord,
)


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

    for node in nodes:
        validate_data_object_ref(node, "inputDataObjectRef", "输入")
        validate_data_object_ref(node, "outputDataObjectRef", "输出")
        if node["type"] == "agent":
            agent_id = node["data"].get("agentId")
            agent_version = node["data"].get("agentVersion")
            if not agent_id or not agent_version:
                errors.append(f"Agent 节点 {node['id']} 必须选择已发布版本")
                continue
            statement = select(AgentVersionRecord).where(
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
