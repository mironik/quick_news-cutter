"""Platform shell — bez GPU/AI importa."""

from shell.platform import get_capabilities, get_runtime_info, resolved_deployment


def test_runtime_info_core_fields():
    info = get_runtime_info()
    assert info["status"] == "ok"
    assert info["shell_api_version"] == 1
    assert info["capabilities"]["core"] is True
    assert "platform" in info
    assert isinstance(info["network_presets"], list)


def test_capabilities_no_heavy_probe():
    caps = get_capabilities()
    assert caps["core"] is True
    assert caps["ingest_local"] is True
    assert caps["ingest_remote_client"] is False
    assert caps["ai_asr"] is False
    assert resolved_deployment() == "portable"


def test_hardware_hints_are_informational_only():
    info = get_runtime_info()
    assert "hardware_hints" in info
    assert isinstance(info["hardware_hints"], list)
