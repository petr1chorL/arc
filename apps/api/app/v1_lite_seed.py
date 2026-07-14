from __future__ import annotations

import argparse
import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.bootstrap import bootstrap_default_workspace
from app.config import Settings
from app.database import create_database
from app.domain import validate_workflow
from app.migrations import DEFAULT_WORKSPACE_SLUG, ensure_current_schema
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    Base,
    ModelProviderRecord,
    NotificationChannelRecord,
    OrganizationRecord,
    RegressionSampleRecord,
    RegressionSampleSetRecord,
    ReviewerRecord,
    RubricRecord,
    RubricVersionRecord,
    UserRecord,
    WorkspaceRecord,
    WorkflowRecord,
    WorkflowVersionRecord,
    utc_now,
)
from app.runtime_security import is_valid_model_secret_ref
from app.schemas import AgentRead, RubricRead, WorkflowRead


AGENT_VERSION = "v1.1.0"
WORKFLOW_VERSION = "v1.4.0"
RUBRIC_VERSION = "v1.1.0"
WORKFLOW_NAME = "AI 赋能方案 V1.0 Lite 试点工作流"
RUBRIC_NAME = "AI 赋能方案 V1.0 Lite Rubric"
SAMPLE_SET_NAME = "AI 赋能方案 V1.0 Lite Golden Set"
REVIEWER_NAME = "V1 Lite 业务审核人"
CHANNEL_NAME = "V1 Lite 页面内通知"


WORKFLOW_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["sourceNotes", "businessContext", "desiredOutput", "riskConcerns"],
    "properties": {
        "sourceNotes": {"type": "string", "title": "课程笔记或业务材料"},
        "businessContext": {"type": "string", "title": "业务背景"},
        "desiredOutput": {"type": "string", "title": "目标输出"},
        "riskConcerns": {"type": "string", "title": "风险关注"},
    },
}

WORKFLOW_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "problemModel": {"type": "object"},
        "workflowDesign": {"type": "object"},
        "rubric": {"type": "object"},
        "reviewDecision": {"type": "object"},
        "finalPlan": {"type": "string"},
    },
}


AGENT_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "信息抽取与问题建模",
        "role": "从课程笔记、业务背景和风险关注中抽取可执行的问题模型",
        "skills": ["结构化提取", "风险识别"],
        "systemPrompt": """你是企业 AI 赋能试点中的信息抽取与问题建模 Agent。

目标：
1. 只根据输入材料抽取事实、约束、角色、输入输出和风险。
2. 把模糊想法整理成可供后续 Workflow 设计使用的问题模型。
3. 不补充输入中不存在的业务事实。

输出必须包含：
- businessGoal：一句话业务目标。
- actors：相关角色列表。
- inputs：关键输入材料。
- desiredOutputs：期望产出。
- constraints：限制条件。
- risks：风险列表。
- openQuestions：仍需人工确认的问题。

如果信息不足，把缺口写入 openQuestions，不要编造。""",
    },
    {
        "name": "AI 赋能工作流设计",
        "role": "把问题模型转成可执行的 Agentic Workflow",
        "skills": ["流程建模", "节点边界设计"],
        "systemPrompt": """你是企业 Agentic Workflow 设计 Agent。

目标：
1. 基于问题模型设计最小可执行 Workflow。
2. 每个节点必须说明输入、输出、负责人、是否需要人工审核。
3. 高风险判断必须进入 Human Review，不得全部自动化。

输出必须包含：
- nodes：节点列表。
- edges：节点连接顺序。
- humanReviewPlacement：为什么在该位置放人工审核。
- qualityGates：每个关键节点的质量门禁。
- outOfScope：当前试点不做的能力。

不要设计超过 7 个节点；V1.0 Lite 优先可跑通，不追求大而全。""",
    },
    {
        "name": "评分与验收体系设计",
        "role": "为最终方案设计 Rubric、权重、门槛和失败处理",
        "skills": ["Rubric 设计", "质量门禁设计"],
        "systemPrompt": """你是 AI 赋能方案的质量评价 Agent。

目标：
1. 设计可观察、可复测、可解释的 Rubric。
2. 每个评分维度必须有权重、评分锚点和失败处理建议。
3. 权重必须服务业务目标，而不是平均分配。

输出必须包含：
- dimensions：评分维度。
- totalPassingScore：总分通过线。
- hardGates：硬性门禁。
- failureActions：低分时的处理动作。
- weightRationale：每个权重的依据。

禁止只写“好/一般/差”这类不可复测描述。""",
    },
    {
        "name": "审核后修订",
        "role": "根据人工审核意见生成最终方案文档",
        "skills": ["方案修订", "变更说明"],
        "systemPrompt": """你是 AI 赋能方案修订 Agent。

目标：
1. 根据人工审核意见修订方案。
2. 保留关键修改理由。
3. 不删除审核人指出的风险，必须在最终方案中回应。

输出必须包含：
- finalPlan：最终方案正文。
- changeLog：逐条说明采纳了哪些审核意见。
- unresolvedRisks：仍未解决的风险。
- nextIteration：建议进入 V1.1+ 的事项。

如果审核意见与输入事实冲突，先标记冲突，不要强行改写事实。""",
    },
]


RUBRIC_DIMENSIONS = [
    {
        "id": "business-goal-clarity",
        "name": "业务目标清晰度",
        "weight": 20,
        "criteria": "业务目标、目标用户、输入材料和期望产出均清晰，且不依赖未声明的业务事实。",
    },
    {
        "id": "workflow-executability",
        "name": "工作流可执行性",
        "weight": 25,
        "criteria": "节点顺序、输入输出、责任角色和人工审核位置完整，可直接用于一次受控试点。",
    },
    {
        "id": "evaluation-operability",
        "name": "质量评价可操作性",
        "weight": 25,
        "criteria": "评分规则、通过线和失败处理可观察、可解释并能在相同输入下复测。",
    },
    {
        "id": "risk-control",
        "name": "风险控制",
        "weight": 20,
        "criteria": "识别关键业务与安全风险，保留人工审核，且提供可追溯的运行证据。",
    },
    {
        "id": "iterability",
        "name": "可迭代性",
        "weight": 10,
        "criteria": "明确当前试点边界、未解决问题和下一迭代建议，避免把规划描述成已实现能力。",
    },
]

RUBRIC_GATE = """通过门槛：
- 总分 >= 80。
- 风险控制 >= 70。
- 如果出现密钥泄露、跳过人工审核、无法追溯 Run ID，直接失败。"""


GOLDEN_SAMPLES = [
    {
        "name": "平台落地路线",
        "input": {
            "sourceNotes": "安克 AI 课程笔记与个人思维导图摘要",
            "businessContext": "希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分",
            "desiredOutput": "平台落地路线与一个可执行试点流程",
            "riskConcerns": "不要大而全失控，先快速试点；质量评分体系要可落地",
        },
        "expected": "明确 V1.0 Lite 先跑一条试点流程；至少包含 Agent、Workflow、Human Review、Evaluation、Observability；说明后置到 V1.1+ 的能力；Rubric 权重可解释，总分通过线明确。",
        "tags": ["v1-lite", "platform"],
    },
    {
        "name": "客服知识沉淀流程",
        "input": {
            "sourceNotes": "客服团队有大量问答记录，但沉淀成知识库慢，质量不稳定",
            "businessContext": "目标是把高频问题转成可审核的知识条目",
            "desiredOutput": "客服知识沉淀 Agent 工作流",
            "riskConcerns": "错误答案、重复知识、未经审核发布",
        },
        "expected": "识别输入为问答记录，输出为知识条目；Human Review 放在发布前；风险控制覆盖错误答案和重复条目；评分维度包含准确性、可复用性和审核完整性。",
        "tags": ["v1-lite", "customer-service"],
    },
    {
        "name": "新品卖点提炼流程",
        "input": {
            "sourceNotes": "新品有参数、竞品对比和用户反馈，但卖点表达分散",
            "businessContext": "市场团队需要形成可审核的卖点草案",
            "desiredOutput": "新品卖点提炼与审核流程",
            "riskConcerns": "夸大宣传、事实依据不足、不同渠道口径不一致",
        },
        "expected": "区分事实依据和营销表达；Human Review 检查夸大宣传风险；Rubric 包含事实准确性、差异化、渠道一致性；未确认事实进入 openQuestions。",
        "tags": ["v1-lite", "marketing"],
    },
]


def _agent_snapshot(record: AgentRecord) -> dict[str, Any]:
    return AgentRead.model_validate(record).model_dump(by_alias=True, mode="json")


def _workflow_snapshot(record: WorkflowRecord) -> dict[str, Any]:
    return WorkflowRead.model_validate(record).model_dump(by_alias=True, mode="json")


def _rubric_snapshot(record: RubricRecord) -> dict[str, Any]:
    return RubricRead.model_validate(record).model_dump(mode="json")


def _find_admin(session: Session, organization_id: str) -> UserRecord:
    admin = session.scalar(
        select(UserRecord)
        .where(
            UserRecord.organization_id == organization_id,
            UserRecord.is_organization_admin.is_(True),
            UserRecord.status == "active",
        )
        .order_by(UserRecord.created_at.asc()),
    )
    if admin is None:
        raise RuntimeError(
            "未找到可用组织管理员。请先按 README 或 bootstrap 脚本创建管理员账号，再运行 V1 Lite 种子脚本。"
        )
    return admin


def _find_workspace(session: Session, workspace_slug: str | None) -> tuple[OrganizationRecord, WorkspaceRecord]:
    if workspace_slug:
        workspaces = list(session.scalars(
            select(WorkspaceRecord)
            .where(WorkspaceRecord.slug == workspace_slug)
            .order_by(WorkspaceRecord.created_at.asc()),
        ))
        for workspace in workspaces:
            organization = session.get(OrganizationRecord, workspace.organization_id)
            if organization is None:
                continue
            admin = session.scalar(
                select(UserRecord).where(
                    UserRecord.organization_id == organization.id,
                    UserRecord.is_organization_admin.is_(True),
                    UserRecord.status == "active",
                ),
            )
            if admin is not None:
                return organization, workspace
        if workspaces:
            workspace = workspaces[0]
            organization = session.get(OrganizationRecord, workspace.organization_id)
            if organization is None:
                raise RuntimeError(f"Workspace 缺少组织记录：{workspace_slug}")
            return organization, workspace

    organization, workspace = bootstrap_default_workspace(session)
    if workspace_slug and workspace.slug != workspace_slug:
        raise RuntimeError(f"Workspace 不存在：{workspace_slug}")
    return organization, workspace


def _available_model_provider(session: Session, workspace_id: str) -> ModelProviderRecord:
    providers = session.scalars(
        select(ModelProviderRecord)
        .where(
            ModelProviderRecord.workspace_id == workspace_id,
            ModelProviderRecord.status != "disabled",
        )
        .order_by(ModelProviderRecord.created_at.asc()),
    ).all()
    for provider in providers:
        required_values = (
            provider.provider_type,
            provider.base_url,
            provider.default_model,
            provider.secret_ref,
        )
        if any(not isinstance(value, str) or not value.strip() for value in required_values):
            continue
        if is_valid_model_secret_ref(provider.secret_ref):
            return provider
    raise RuntimeError(
        "V1 Lite 种子需要当前 Workspace 中配置完整且未停用的模型 Provider。"
    )


def _ensure_reviewer(session: Session, workspace_id: str, admin: UserRecord) -> ReviewerRecord:
    reviewer = session.scalar(
        select(ReviewerRecord).where(
            ReviewerRecord.workspace_id == workspace_id,
            ReviewerRecord.name == REVIEWER_NAME,
        ),
    )
    if reviewer is None:
        reviewer = ReviewerRecord(
            workspace_id=workspace_id,
            user_id=admin.id,
            name=REVIEWER_NAME,
            role="业务负责人",
            is_expert=True,
            is_active=True,
        )
        session.add(reviewer)
        session.flush()
    reviewer.user_id = admin.id
    reviewer.role = "业务负责人"
    reviewer.is_expert = True
    reviewer.is_active = True
    return reviewer


def _ensure_agent_versions(
    session: Session,
    workspace_id: str,
    provider: ModelProviderRecord,
) -> list[AgentRecord]:
    agents: list[AgentRecord] = []
    now = utc_now()
    for template in AGENT_TEMPLATES:
        agent = session.scalar(
            select(AgentRecord).where(
                AgentRecord.workspace_id == workspace_id,
                AgentRecord.name == template["name"],
            ),
        )
        if agent is None:
            agent = AgentRecord(
                workspace_id=workspace_id,
                name=template["name"],
                role=template["role"],
                owner="V1 Lite 试点团队",
                model=provider.default_model,
                model_provider_id=provider.id,
                model_provider=provider.provider_type,
                model_base_url=provider.base_url,
                temperature=0.2,
                max_output_tokens=1600,
                status="在线",
                version=AGENT_VERSION,
                tools=[],
                skills=template["skills"],
                tool_asset_refs=[],
                skill_asset_refs=[],
                system_prompt=template["systemPrompt"],
                created_at=now,
                updated_at=now,
            )
            session.add(agent)
            session.flush()
        else:
            agent.role = template["role"]
            agent.owner = "V1 Lite 试点团队"
            agent.model = provider.default_model
            agent.model_provider_id = provider.id
            agent.model_provider = provider.provider_type
            agent.model_base_url = provider.base_url
            agent.temperature = 0.2
            agent.max_output_tokens = 1600
            agent.status = "在线"
            agent.version = AGENT_VERSION
            agent.tools = []
            agent.skills = template["skills"]
            agent.system_prompt = template["systemPrompt"]
            agent.updated_at = now

        version = session.scalar(
            select(AgentVersionRecord).where(
                AgentVersionRecord.workspace_id == workspace_id,
                AgentVersionRecord.agent_id == agent.id,
                AgentVersionRecord.version == AGENT_VERSION,
            ),
        )
        if version is None:
            session.add(
                AgentVersionRecord(
                    workspace_id=workspace_id,
                    agent_id=agent.id,
                    version=AGENT_VERSION,
                    snapshot=_agent_snapshot(agent),
                ),
            )
        agents.append(agent)
    session.flush()
    return agents


def _workflow_nodes(
    agents: list[AgentRecord],
    reviewer: ReviewerRecord,
    rubric: RubricRecord,
    rubric_version: RubricVersionRecord,
) -> list[dict[str, Any]]:
    agent_by_name = {agent.name: agent for agent in agents}
    return [
        {
            "id": "start",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "Start"},
        },
        {
            "id": "agent-problem-model",
            "type": "agent",
            "position": {"x": 240, "y": 0},
            "data": {
                "label": "信息抽取与问题建模",
                "agentId": agent_by_name["信息抽取与问题建模"].id,
                "agentVersion": AGENT_VERSION,
            },
        },
        {
            "id": "agent-workflow-design",
            "type": "agent",
            "position": {"x": 500, "y": 0},
            "data": {
                "label": "AI 赋能工作流设计",
                "agentId": agent_by_name["AI 赋能工作流设计"].id,
                "agentVersion": AGENT_VERSION,
            },
        },
        {
            "id": "agent-rubric-design",
            "type": "agent",
            "position": {"x": 760, "y": 0},
            "data": {
                "label": "评分与验收体系设计",
                "agentId": agent_by_name["评分与验收体系设计"].id,
                "agentVersion": AGENT_VERSION,
            },
        },
        {
            "id": "human-business-review",
            "type": "human",
            "position": {"x": 1020, "y": 0},
            "data": {
                "label": "业务负责人审核",
                "assignmentType": "direct_reviewer",
                "reviewPolicy": "any_one",
                "requiredApprovals": 1,
                "reviewerIds": [reviewer.id],
                "dueMinutes": 240,
                "escalationMinutes": 480,
                "instructions": "请检查业务目标、节点边界、人工审核位置、Rubric 可操作性和风险控制。",
            },
        },
        {
            "id": "agent-revision",
            "type": "agent",
            "position": {"x": 1280, "y": 0},
            "data": {
                "label": "审核后修订",
                "agentId": agent_by_name["审核后修订"].id,
                "agentVersion": AGENT_VERSION,
            },
        },
        {
            "id": "evaluation-placeholder",
            "type": "evaluation",
            "position": {"x": 1540, "y": 0},
            "data": {
                "label": "Rubric 评分",
                "rubricRef": {
                    "rubricId": rubric.id,
                    "versionId": rubric_version.id,
                    "version": rubric_version.version,
                    "name": rubric.name,
                },
            },
        },
        {
            "id": "end",
            "type": "end",
            "position": {"x": 1800, "y": 0},
            "data": {"label": "End"},
        },
    ]


def _workflow_edges() -> list[dict[str, Any]]:
    pairs = [
        ("start", "agent-problem-model"),
        ("agent-problem-model", "agent-workflow-design"),
        ("agent-workflow-design", "agent-rubric-design"),
        ("agent-workflow-design", "human-business-review"),
        ("agent-rubric-design", "human-business-review"),
        ("human-business-review", "agent-revision"),
        ("agent-revision", "evaluation-placeholder"),
        ("evaluation-placeholder", "end"),
    ]
    return [
        {
            "id": f"{source}-{target}",
            "source": source,
            "target": target,
            **(
                {"data": {"includeReviewContext": True}}
                if (source, target) == ("human-business-review", "agent-revision")
                else {}
            ),
        }
        for source, target in pairs
    ]


def _ensure_workflow(
    session: Session,
    workspace_id: str,
    agents: list[AgentRecord],
    reviewer: ReviewerRecord,
    rubric: RubricRecord,
    rubric_version: RubricVersionRecord,
) -> WorkflowRecord:
    nodes = _workflow_nodes(agents, reviewer, rubric, rubric_version)
    edges = _workflow_edges()
    errors = validate_workflow(nodes, edges, session, workspace_id)
    if errors:
        raise RuntimeError(f"V1 Lite Workflow 校验失败：{'; '.join(errors)}")

    workflow = session.scalar(
        select(WorkflowRecord).where(
            WorkflowRecord.workspace_id == workspace_id,
            WorkflowRecord.name == WORKFLOW_NAME,
        ),
    )
    now = utc_now()
    if workflow is None:
        workflow = WorkflowRecord(
            workspace_id=workspace_id,
            name=WORKFLOW_NAME,
            status="已发布",
            version=WORKFLOW_VERSION,
            nodes=nodes,
            edges=edges,
            input_schema=WORKFLOW_INPUT_SCHEMA,
            output_schema=WORKFLOW_OUTPUT_SCHEMA,
            created_at=now,
            updated_at=now,
        )
        session.add(workflow)
        session.flush()
    else:
        workflow.status = "已发布"
        workflow.version = WORKFLOW_VERSION
        workflow.nodes = nodes
        workflow.edges = edges
        workflow.input_schema = WORKFLOW_INPUT_SCHEMA
        workflow.output_schema = WORKFLOW_OUTPUT_SCHEMA
        workflow.updated_at = now

    version = session.scalar(
        select(WorkflowVersionRecord).where(
            WorkflowVersionRecord.workspace_id == workspace_id,
            WorkflowVersionRecord.workflow_id == workflow.id,
            WorkflowVersionRecord.version == WORKFLOW_VERSION,
        ),
    )
    if version is None:
        session.add(
            WorkflowVersionRecord(
                workspace_id=workspace_id,
                workflow_id=workflow.id,
                version=WORKFLOW_VERSION,
                snapshot=_workflow_snapshot(workflow),
            ),
        )
    session.flush()
    return workflow


def _ensure_rubric(
    session: Session,
    workspace_id: str,
    provider: ModelProviderRecord,
) -> tuple[RubricRecord, RubricVersionRecord]:
    rubric = session.scalar(
        select(RubricRecord).where(
            RubricRecord.workspace_id == workspace_id,
            RubricRecord.name == RUBRIC_NAME,
            RubricRecord.version == RUBRIC_VERSION,
        ),
    )
    if rubric is None:
        rubric = session.scalar(
            select(RubricRecord)
            .where(
                RubricRecord.workspace_id == workspace_id,
                RubricRecord.name == RUBRIC_NAME,
            )
            .order_by(RubricRecord.created_at.asc()),
        )
    now = utc_now()
    if rubric is None:
        rubric = RubricRecord(
            workspace_id=workspace_id,
            name=RUBRIC_NAME,
            artifact="AI 赋能方案最终产出",
            dimensions=RUBRIC_DIMENSIONS,
            gate=RUBRIC_GATE,
            pass_score=80,
            judge_type="llm",
            judge_model=provider.default_model,
            model_provider_id=provider.id,
            version=RUBRIC_VERSION,
            status="active",
            sort_order=1,
            created_at=now,
            updated_at=now,
        )
        session.add(rubric)
        session.flush()
    else:
        rubric.artifact = "AI 赋能方案最终产出"
        rubric.dimensions = RUBRIC_DIMENSIONS
        rubric.gate = RUBRIC_GATE
        rubric.pass_score = 80
        rubric.judge_type = "llm"
        rubric.judge_model = provider.default_model
        rubric.model_provider_id = provider.id
        rubric.version = RUBRIC_VERSION
        rubric.status = "active"
        rubric.sort_order = 1
        rubric.updated_at = now

    version = session.scalar(
        select(RubricVersionRecord).where(
            RubricVersionRecord.workspace_id == workspace_id,
            RubricVersionRecord.rubric_id == rubric.id,
            RubricVersionRecord.version == RUBRIC_VERSION,
        ),
    )
    if version is None:
        version = RubricVersionRecord(
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            version=RUBRIC_VERSION,
            snapshot=_rubric_snapshot(rubric),
        )
        session.add(version)
    session.flush()
    return rubric, version


def _ensure_sample_set(session: Session, workspace_id: str, admin: UserRecord) -> RegressionSampleSetRecord:
    sample_set = session.scalar(
        select(RegressionSampleSetRecord).where(
            RegressionSampleSetRecord.workspace_id == workspace_id,
            RegressionSampleSetRecord.name == SAMPLE_SET_NAME,
        ),
    )
    now = utc_now()
    if sample_set is None:
        sample_set = RegressionSampleSetRecord(
            workspace_id=workspace_id,
            name=SAMPLE_SET_NAME,
            description="V1.0 Lite 默认试点流程回归样本。",
            status="active",
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        session.add(sample_set)
        session.flush()
    else:
        sample_set.description = "V1.0 Lite 默认试点流程回归样本。"
        sample_set.status = "active"
        sample_set.updated_at = now

    for sample in GOLDEN_SAMPLES:
        existing = session.scalar(
            select(RegressionSampleRecord).where(
                RegressionSampleRecord.workspace_id == workspace_id,
                RegressionSampleRecord.sample_set_id == sample_set.id,
                RegressionSampleRecord.name == sample["name"],
            ),
        )
        input_text = json.dumps(sample["input"], ensure_ascii=False, indent=2)
        if existing is None:
            session.add(
                RegressionSampleRecord(
                    workspace_id=workspace_id,
                    sample_set_id=sample_set.id,
                    name=sample["name"],
                    input_text=input_text,
                    expected_output=sample["expected"],
                    tags=sample["tags"],
                    source_type="v1_lite_seed",
                    source_id=sample["name"],
                    status="active",
                    created_by=admin.id,
                    created_at=now,
                    updated_at=now,
                ),
            )
        else:
            existing.input_text = input_text
            existing.expected_output = sample["expected"]
            existing.tags = sample["tags"]
            existing.source_type = "v1_lite_seed"
            existing.source_id = sample["name"]
            existing.status = "active"
            existing.updated_at = now
    session.flush()
    return sample_set


def _ensure_notification_channel(
    session: Session,
    workspace_id: str,
    admin: UserRecord,
) -> NotificationChannelRecord:
    channel = session.scalar(
        select(NotificationChannelRecord).where(
            NotificationChannelRecord.workspace_id == workspace_id,
            NotificationChannelRecord.name == CHANNEL_NAME,
        ),
    )
    now = utc_now()
    if channel is None:
        channel = NotificationChannelRecord(
            workspace_id=workspace_id,
            name=CHANNEL_NAME,
            channel_type="in_app",
            status="active",
            config={"purpose": "v1_lite_pilot"},
            secret_ref="",
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        session.add(channel)
        session.flush()
    else:
        channel.channel_type = "in_app"
        channel.status = "active"
        channel.config = {"purpose": "v1_lite_pilot"}
        channel.secret_ref = ""
        channel.updated_at = now
    return channel


def seed_v1_lite_assets(
    session: Session,
    *,
    workspace_slug: str | None = DEFAULT_WORKSPACE_SLUG,
) -> dict[str, Any]:
    organization, workspace = _find_workspace(session, workspace_slug)
    admin = _find_admin(session, organization.id)
    provider = _available_model_provider(session, workspace.id)
    reviewer = _ensure_reviewer(session, workspace.id, admin)
    agents = _ensure_agent_versions(session, workspace.id, provider)
    rubric, rubric_version = _ensure_rubric(session, workspace.id, provider)
    workflow = _ensure_workflow(
        session,
        workspace.id,
        agents,
        reviewer,
        rubric,
        rubric_version,
    )
    sample_set = _ensure_sample_set(session, workspace.id, admin)
    channel = _ensure_notification_channel(session, workspace.id, admin)
    session.commit()

    sample_count = session.scalar(
        select(func.count())
        .select_from(RegressionSampleRecord)
        .where(
            RegressionSampleRecord.workspace_id == workspace.id,
            RegressionSampleRecord.sample_set_id == sample_set.id,
            RegressionSampleRecord.status == "active",
        ),
    ) or 0

    return {
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
            "slug": workspace.slug,
        },
        "admin": {
            "id": admin.id,
            "email": admin.email,
        },
        "modelProvider": {
            "id": provider.id,
            "name": provider.name,
            "model": provider.default_model,
        },
        "reviewer": {
            "id": reviewer.id,
            "name": reviewer.name,
            "userId": reviewer.user_id,
        },
        "agents": [
            {"id": agent.id, "name": agent.name, "version": AGENT_VERSION}
            for agent in agents
        ],
        "workflow": {
            "id": workflow.id,
            "name": workflow.name,
            "version": WORKFLOW_VERSION,
        },
        "rubric": {
            "id": rubric.id,
            "name": rubric.name,
            "version": RUBRIC_VERSION,
        },
        "sampleSet": {
            "id": sample_set.id,
            "name": sample_set.name,
            "activeSamples": sample_count,
        },
        "notificationChannel": {
            "id": channel.id,
            "name": channel.name,
            "channelType": channel.channel_type,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ARC.ONE V1.0 Lite pilot assets.")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--workspace-slug", default=DEFAULT_WORKSPACE_SLUG)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    settings = Settings()
    database_url = args.database_url or settings.database_url
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    ensure_current_schema(engine)
    with session_factory() as session:
        result = seed_v1_lite_assets(session, workspace_slug=args.workspace_slug)

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("V1.0 Lite 试点资产已就绪")
    print(f"Workspace: {result['workspace']['name']} ({result['workspace']['slug']})")
    print(f"Agents: {len(result['agents'])}")
    print(f"Workflow: {result['workflow']['name']} @ {result['workflow']['version']}")
    print(f"Rubric: {result['rubric']['name']} @ {result['rubric']['version']}")
    print(f"Golden samples: {result['sampleSet']['activeSamples']}")


if __name__ == "__main__":
    main()
