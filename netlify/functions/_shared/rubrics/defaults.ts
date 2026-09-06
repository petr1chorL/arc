// Literal baseline from Python DEFAULT_RUBRICS, independently compared without importing the application.
export const DEFAULT_RUBRICS = [
  {
    "name": "竞品分析质量标准",
    "artifact": "竞品分析矩阵",
    "dimensions": [
      {
        "name": "事实准确性",
        "weight": 25
      },
      {
        "name": "信息完整性",
        "weight": 20
      },
      {
        "name": "洞察价值",
        "weight": 25
      },
      {
        "name": "业务相关性",
        "weight": 15
      },
      {
        "name": "结构与复用",
        "weight": 10
      },
      {
        "name": "风险控制",
        "weight": 5
      }
    ],
    "gate": "来源完整率 = 100%，竞品数量 >= 5",
    "pass_score": 85,
    "version": "v2.1",
    "status": "active"
  },
  {
    "name": "需求洞察质量标准",
    "artifact": "用户需求对象",
    "dimensions": [
      {
        "name": "证据可信度",
        "weight": 30
      },
      {
        "name": "需求聚类质量",
        "weight": 20
      },
      {
        "name": "场景完整性",
        "weight": 20
      },
      {
        "name": "机会可行动性",
        "weight": 20
      },
      {
        "name": "可追溯性",
        "weight": 10
      }
    ],
    "gate": "每条结论至少关联 3 条原始证据",
    "pass_score": 80,
    "version": "v1.6",
    "status": "active"
  },
  {
    "name": "产品定义准入标准",
    "artifact": "产品定义文档",
    "dimensions": [
      {
        "name": "战略一致性",
        "weight": 25
      },
      {
        "name": "用户价值",
        "weight": 25
      },
      {
        "name": "技术可行性",
        "weight": 20
      },
      {
        "name": "商业潜力",
        "weight": 20
      },
      {
        "name": "风险完备性",
        "weight": 10
      }
    ],
    "gate": "关键指标、目标用户、成本边界均不得为空",
    "pass_score": 88,
    "version": "v0.9",
    "status": "active"
  }
]
