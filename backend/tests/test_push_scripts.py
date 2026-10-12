import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fly = _load("push_fly_costs")
neon = _load("push_neon_usage")

DAY = 86400


def _machine(machine_id, cpus=1, memory_mb=256, cpu_kind="shared"):
    return {
        "id": machine_id,
        "config": {"guest": {"cpu_kind": cpu_kind, "cpus": cpus, "memory_mb": memory_mb}},
    }


def test_machine_price_matches_published_presets():
    assert round(fly.machine_monthly_price({"cpus": 1, "memory_mb": 256}), 2) == 1.95
    assert round(fly.machine_monthly_price({"cpus": 1, "memory_mb": 512}), 2) == 2.60
    assert round(fly.machine_monthly_price({"cpus": 2, "memory_mb": 1024}), 2) == 5.20
    assert fly.machine_monthly_price({"cpu_kind": "performance", "cpus": 1}) is None


def test_daily_uptime_attributes_each_step_to_the_previous_day():
    oct2 = datetime(2026, 10, 2, tzinfo=timezone.utc).timestamp()
    response = {"data": {"result": [
        {"metric": {"app": "a", "instance": "m1"}, "values": [[oct2, "240"], [oct2 + DAY, "4"]]},
        {"metric": {"app": "b"}, "values": [[oct2, "9"]]},  # no instance label: skipped
    ]}}
    days = fly.daily_uptime(response)
    assert list(days) == ["2026-10-01", "2026-10-02"]
    assert days["2026-10-01"] == {"a": {"m1": 3600.0}}
    assert days["2026-10-02"] == {"a": {"m1": 60.0}}


def test_merge_days_keeps_aged_out_days_and_never_shrinks():
    cached = {"2026-10-01": {"a": {"m1": 3600.0}}, "2026-10-02": {"a": {"m1": 600.0}}}
    fresh = {"2026-10-02": {"a": {"m1": 300.0, "m2": 60.0}}, "2026-10-03": {"b": {"m3": 15.0}}}
    merged = fly.merge_days(cached, fresh)
    assert merged["2026-10-01"] == {"a": {"m1": 3600.0}}
    assert merged["2026-10-02"] == {"a": {"m1": 600.0, "m2": 60.0}}
    assert merged["2026-10-03"] == {"b": {"m3": 15.0}}
    assert cached["2026-10-02"] == {"a": {"m1": 600.0}}  # input untouched


def test_app_costs_prices_uptime_by_machine_size_plus_volumes_and_dedicated_ip():
    machines = [_machine("m1", memory_mb=512)]
    uptime = {"m1": 10 * DAY, "gone": 10 * DAY}  # destroyed machine priced like m1
    volumes = [{"size_gb": 2}]
    ips = [{"Type": "v4"}, {"Type": "shared_v4"}, {"Type": "v6"}]
    third = 10 * DAY / fly.MONTH_SECONDS
    expected = 2 * 2.60 * third + 2 * 0.15 * third + 2.0 * third
    assert abs(fly.app_costs(uptime, machines, volumes, ips, third) - expected) < 1e-9
    assert fly.app_costs({}, [], [], [], third) == 0


def test_build_payload_sums_estimates_and_keeps_invoice_separate():
    payload = fly.build_payload({"a": 1.234, "b": 2.0}, {"a": 3.0, "b": 0.5}, "2026-10", 17.75)
    assert payload["total_usd"] == 3.23
    assert payload["by_app"] == {"a": 1.23, "b": 2.0}
    assert payload["machine_hours"] == {"a": 3.0, "b": 0.5}
    assert payload["invoice_total_usd"] == 17.75
    assert "invoice_total_usd" not in fly.build_payload({}, {}, "2026-10", None)


def test_payloads_validate_against_backend_schemas():
    from app.schemas import NeonUsageIn, ProviderCostIn

    ProviderCostIn.model_validate(fly.build_payload({"a": 1.0}, {"a": 2.0}, "2026-09", 5.0))
    payload = neon.build_payload({"p1": 3600.0}, {"p1": "gym-tracker"}, "2026-09", "free_v3")
    assert NeonUsageIn.model_validate(payload).free_hours_per_project == 100.0
    assert "free_hours_per_project" not in neon.build_payload({}, {}, "2026-09", "launch")


def test_neon_sums_legacy_and_v2_shapes_and_maps_names():
    response = {
        "projects": [
            {"project_id": "p1", "periods": [{"consumption": [
                {"compute_time_seconds": 3600}, {"compute_time_seconds": 1800}]}]},
            {"project_id": "p2", "periods": [{"consumption": [
                {"metrics": [{"metric_name": "compute_unit_seconds", "value": 7200}]}]}]},
            {"project_id": "p3", "periods": [{"consumption": [{"compute_unit_seconds": 360}]}]},
        ]
    }
    seconds = neon.project_seconds(response)
    assert seconds == {"p1": 5400.0, "p2": 7200.0, "p3": 360.0}
    payload = neon.build_payload(seconds, {"p1": "gym-tracker", "p2": "vinyl"}, "2026-09")
    assert payload["by_app"] == {"gym-tracker": 1.5, "p3": 0.1, "vinyl": 2.0}
    assert payload["total_compute_hours"] == 3.6


def test_post_metrics_needs_config():
    import push_common

    assert push_common.post_metrics("neon", {}, {}) is False


def test_load_config_accepts_powershell_utf8_bom(tmp_path, monkeypatch):
    import push_common

    config_file = tmp_path / "aisaac_push.json"
    config_file.write_text('{"AISAAC_DASHBOARD_URL": "https://x.example"}', encoding="utf-8-sig")
    monkeypatch.setattr(push_common, "CONFIG_FILE", config_file)
    monkeypatch.delenv("AISAAC_DASHBOARD_URL", raising=False)
    assert push_common.load_config()["AISAAC_DASHBOARD_URL"] == "https://x.example"


def test_neon_counter_fallback_reads_cpu_used_sec():
    projects = [{"id": "p1", "cpu_used_sec": 7200}, {"id": "p2", "cpu_used_sec": None},
                {"id": "p3"}]
    assert neon.counter_seconds(projects) == {"p1": 7200.0, "p2": 0.0, "p3": 0.0}
