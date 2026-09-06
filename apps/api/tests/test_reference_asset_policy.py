import copy
import json
from pathlib import Path

import pytest

from app.reference_asset_policy import AssetConfigurationError, validate_adapter_config


def test_manual_rejects_inline_configuration_without_echo():
    with pytest.raises(AssetConfigurationError) as captured:
        validate_adapter_config("manual", {"token": "synthetic-sensitive-marker"})
    assert str(captured.value) == "资产配置包含不支持或不安全的字段"


CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures/reference-assets-policy.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_configuration_contract(case):
    original = copy.deepcopy(case["config"])
    if case["valid"]:
        validate_adapter_config(case["type"], case["config"])
    else:
        with pytest.raises(AssetConfigurationError):
            validate_adapter_config(case["type"], case["config"])
    assert case["config"] == original
