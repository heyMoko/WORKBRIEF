"""Check the web route with real HTTP requests inside the test process."""

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import api


client = TestClient(api.app)


def test_report_returns_sales():
    response = client.get("/report")

    assert response.status_code == 200
    assert response.json() == {
        "previous_month": "2026-09",
        "current_month": "2026-10",
        "branches": [
            {"branch": "강남점", "previous_amount": 120000, "current_amount": 150000, "change": 30000},
            {"branch": "건대점", "previous_amount": 80000, "current_amount": 60000, "change": -20000},
        ]
    }


def test_bad_sales_file_returns_error(tmp_path, monkeypatch):
    bad_file = tmp_path / "sales.csv"
    bad_file.write_text(
        "거래일,지점,매출액,거래ID\n2026-10-01,강남점,,A001\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(api, "SALES_FILE", bad_file)

    response = client.get("/report")
    assert response.status_code == 422
    assert response.json() == {"detail": ["매출액이 비어 있어 무시: A001"]}


def test_upload_returns_sales():
    sample = Path(__file__).with_name("sales.csv").read_bytes()
    response = client.post("/report/upload", files={"file": ("sales.csv", sample, "text/csv")})

    assert response.status_code == 200
    assert response.json()["branches"][0]["change"] == 30000


def test_upload_rejects_bad_rows():
    bad_csv = "거래일,지점,매출액,거래ID\n2026-10-01,강남점,,A001\n".encode()
    response = client.post("/report/upload", files={"file": ("sales.csv", bad_csv, "text/csv")})

    assert response.status_code == 422
    assert response.json() == {"detail": ["매출액이 비어 있어 무시: A001"]}


def test_upload_rejects_missing_columns():
    bad_csv = "거래일,지점\n2026-10-01,강남점\n".encode()
    response = client.post("/report/upload", files={"file": ("sales.csv", bad_csv, "text/csv")})

    assert response.status_code == 422
    assert response.json() == {"detail": ["필수 열 없음: 매출액, 거래ID"]}


def test_upload_rejects_large_file():
    large_csv = b"a" * (api.MAX_CSV_BYTES + 1)
    response = client.post("/report/upload", files={"file": ("sales.csv", large_csv, "text/csv")})

    assert response.status_code == 413


def test_upload_finds_other_months_and_branches():
    csv_text = (
        "거래일,지점,매출액,거래ID\n"
        "2026-10-01,신촌점,70000,B001\n"
        "2026-11-01,신촌점,90000,B002\n"
        "2026-11-02,홍대점,30000,B003\n"
    )
    response = client.post(
        "/report/upload", files={"file": ("sales.csv", csv_text.encode("utf-8"), "text/csv")}
    )

    assert response.status_code == 200
    assert response.json() == {
        "previous_month": "2026-10",
        "current_month": "2026-11",
        "branches": [
            {"branch": "신촌점", "previous_amount": 70000, "current_amount": 90000, "change": 20000},
            {"branch": "홍대점", "previous_amount": 0, "current_amount": 30000, "change": 30000},
        ],
    }


def test_upload_rejects_three_months():
    csv_text = (
        "거래일,지점,매출액,거래ID\n"
        "2026-09-01,강남점,10000,C001\n"
        "2026-10-01,강남점,20000,C002\n"
        "2026-11-01,강남점,30000,C003\n"
    )
    response = client.post(
        "/report/upload", files={"file": ("sales.csv", csv_text.encode("utf-8"), "text/csv")}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "비교하려면 정확히 두 달의 거래가 필요합니다."}


def test_ai_report_requires_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    sample = Path(__file__).with_name("sales.csv").read_bytes()
    response = client.post("/report/upload/ai", files={"file": ("sales.csv", sample, "text/csv")})

    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_ai_report_keeps_calculated_numbers(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    usage = {
        "model": "gpt-6-luna",
        "input_tokens": 100,
        "output_tokens": 20,
        "total_tokens": 120,
        "elapsed_ms": 250,
        "estimated_cost_usd": 0.00002,
    }
    monkeypatch.setattr(
        api, "generate_commentary", lambda report: ("강남점은 늘고 건대점은 줄었습니다.", usage)
    )
    sample = Path(__file__).with_name("sales.csv").read_bytes()
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    response = client.post("/report/upload/ai", files={"file": ("sales.csv", sample, "text/csv")})

    assert response.status_code == 200
    data = response.json()
    assert data["report"]["branches"][0]["change"] == 30000
    assert "150,000원" in data["draft"]
    assert "강남점은 늘고 건대점은 줄었습니다." in data["draft"]
    assert data["usage"] == usage
    history = client.get("/report/usage").json()
    assert history["summary"]["calls"] == 1
    assert history["summary"]["total_tokens"] == 120
    assert history["recent"][0]["model"] == "gpt-6-luna"


def test_usage_history_is_empty_without_ai_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    response = client.get("/report/usage")

    assert response.status_code == 200
    assert response.json()["summary"] == {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "estimated_cost_usd": 0,
    }


def test_ai_report_rejects_model_number(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(api, "generate_commentary", lambda report: ("매출이 99% 올랐습니다.", {}))
    sample = Path(__file__).with_name("sales.csv").read_bytes()
    response = client.post("/report/upload/ai", files={"file": ("sales.csv", sample, "text/csv")})

    assert response.status_code == 422
    assert "숫자 검증" in response.json()["detail"]


def test_ai_report_checks_csv_before_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(api, "generate_commentary", lambda report: (_ for _ in ()).throw(AssertionError()))
    response = client.post("/report/upload/ai", files={"file": ("bad.csv", b"invalid", "text/csv")})

    assert response.status_code == 422


def test_ai_adapter_sends_only_report_and_disables_storage(monkeypatch):
    import openai

    captured = {}

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            usage = SimpleNamespace(
                input_tokens=500,
                output_tokens=200,
                total_tokens=700,
                input_tokens_details=SimpleNamespace(cached_tokens=100, cache_write_tokens=0),
            )
            return SimpleNamespace(
                output_parsed=api.AICommentary(commentary=" 강남점이 늘었습니다. "),
                usage=usage,
                model="gpt-6-luna",
            )

    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: SimpleNamespace(responses=FakeResponses()))
    report = {"previous_month": "2026-09", "current_month": "2026-10", "branches": []}

    commentary, usage = api.generate_commentary(report)
    assert commentary == "강남점이 늘었습니다."
    assert usage["input_tokens"] == 500
    assert usage["output_tokens"] == 200
    assert usage["total_tokens"] == 700
    assert usage["estimated_cost_usd"] == 0.000141
    assert captured["store"] is False
    assert captured["text_format"] is api.AICommentary
    assert captured["reasoning"] == {"effort": "low"}
    assert captured["max_output_tokens"] == 300
    assert captured["text"] == {"verbosity": "low"}
    assert '"previous_month"' in captured["input"][1]["content"]


def test_unknown_model_cost_is_not_guessed():
    assert api.estimate_cost_usd("unknown-model", 100, 100) is None


def test_ai_usage_accepts_none_cache_values(monkeypatch):
    import openai

    class FakeResponses:
        def parse(self, **kwargs):
            usage = SimpleNamespace(
                input_tokens=100,
                output_tokens=20,
                total_tokens=120,
                input_tokens_details=SimpleNamespace(
                    cached_tokens=None,
                    cache_write_tokens=None,
                ),
            )
            return SimpleNamespace(
                output_parsed=api.AICommentary(commentary="강남점이 늘었습니다."),
                usage=usage,
                model=None,
            )

    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: SimpleNamespace(responses=FakeResponses()))
    _, usage = api.generate_commentary({"branches": []})

    assert usage["model"] == "gpt-6-luna"
    assert usage["estimated_cost_usd"] == 0.00002


def test_document_upload_splits_and_searches_by_keyword(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    manual = (
        "# 운영 매뉴얼\n\n"
        "당일에 취소된 거래는 매출에서 제외합니다.\n\n"
        "매출액이 비어 있는 행은 자동으로 고치지 않습니다."
    ).encode("utf-8")
    upload = client.post(
        "/documents/upload",
        files={"file": ("manual.txt", manual, "text/plain")},
    )

    assert upload.status_code == 200
    assert upload.json()["chunks"] == 1

    response = client.get("/documents/search", params={"query": "취소 거래 매출 제외"})

    assert response.status_code == 200
    source = response.json()["sources"][0]
    assert source["document_name"] == "manual.txt"
    assert source["chunk_index"] == 1
    assert "취소된 거래는 매출에서 제외" in source["content"]
    assert source["score"] == 4


def test_document_search_returns_no_source_for_unrelated_question(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    client.post(
        "/documents/upload",
        files={"file": ("manual.txt", "취소 거래는 매출에서 제외합니다.".encode(), "text/plain")},
    )

    response = client.get("/documents/search", params={"query": "휴가 일정"})

    assert response.status_code == 200
    assert response.json()["sources"] == []


def test_document_upload_rejects_non_text_file(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")

    response = client.post(
        "/documents/upload",
        files={"file": ("manual.pdf", b"not a real pdf", "application/pdf")},
    )

    assert response.status_code == 415
    assert "txt 또는 .md" in response.json()["detail"]
