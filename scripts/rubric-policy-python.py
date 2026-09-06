"""Evaluate synthetic JSON against the authoritative RubricWrite schema only."""
import json
import ast
from pathlib import Path
import sys
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from pydantic import ValidationError
from app.schemas import RubricWrite


def parse(value):
    try:
        return {"status": 200, "body": RubricWrite.model_validate(value).model_dump()}
    except ValidationError:
        return {"status": 422, "body": {"detail": "量规或样本请求字段不符合要求"}}


if __name__ == "__main__":
    if sys.argv[1:] == ["--defaults"]:
        module = ast.parse(sys.stdin.buffer.read().decode("utf-8-sig"))
        declaration = next(node for node in module.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "DEFAULT_RUBRICS" for target in node.targets))
        print(json.dumps(ast.literal_eval(declaration.value), ensure_ascii=True))
    elif sys.argv[1:] == ["--casefold"]:
        print(json.dumps({"unicodeVersion": unicodedata.unidata_version,
            "mapping": {str(i): chr(i).casefold() for i in range(0x110000) if chr(i).casefold() != chr(i)}}, ensure_ascii=True))
    else:
        cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        print(json.dumps([parse(case["body"]) for case in cases], ensure_ascii=True))
