"""Fixed read errors for persisted rubric governance data; never repair records implicitly."""
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas import RubricRead, RubricVersionRead


def require_rubric_read(value: object) -> RubricRead:
    """Validate before response serialization or committing a lifecycle mutation."""
    try:
        return RubricRead.model_validate(value)
    except ValidationError:
        raise HTTPException(status_code=409, detail="历史评分量规结构不符合要求，需先完成治理") from None


def require_rubric_version_read(value: object) -> RubricVersionRead:
    """Return a safe history projection without reflecting invalid stored fields."""
    try:
        return RubricVersionRead.model_validate(value)
    except ValidationError:
        raise HTTPException(status_code=409, detail="历史评分量规结构不符合要求，需先完成治理") from None
