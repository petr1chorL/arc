from collections import deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentVersionRecord


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

    for node in nodes:
        if node["type"] != "agent":
            continue
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

    return errors
