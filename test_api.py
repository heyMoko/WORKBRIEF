"""Check the web route with real HTTP requests inside the test process."""

from pathlib import Path

import pytest
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


def test_semantic_index_and_search_find_meaning_match(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    document_id = api.save_document(
        "refund.md",
        "test document",
        [
            "환불이 확정된 달의 조정 항목으로 기록합니다.",
            "휴가 일정은 인사팀에 문의합니다.",
        ],
    )

    def fake_create_embeddings(texts):
        if texts == ["돈을 돌려준 거래는 어디에 기록해?"]:
            return "test-embedding", [[1.0, 0.0]]
        return "test-embedding", [[1.0, 0.0], [0.0, 1.0]]

    monkeypatch.setattr(api, "create_embeddings", fake_create_embeddings)

    index = client.post(f"/documents/{document_id}/index")
    assert index.status_code == 200
    assert index.json()["indexed_chunks"] == 2

    response = client.get(
        "/documents/search",
        params={"query": "돈을 돌려준 거래는 어디에 기록해?", "mode": "semantic"},
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "semantic"
    assert "환불이 확정된 달" in response.json()["sources"][0]["content"]
    assert response.json()["sources"][0]["score"] == 1.0


def test_semantic_search_explains_when_document_is_not_indexed(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    monkeypatch.setattr(api, "create_embeddings", lambda texts: ("test-embedding", [[1.0, 0.0]]))
    api.save_document("manual.md", "내용", ["취소 거래는 매출에서 제외합니다."])

    response = client.get(
        "/documents/search",
        params={"query": "취소 거래", "mode": "semantic"},
    )

    assert response.status_code == 409
    assert "의미 검색 준비" in response.json()["detail"]


def test_cosine_similarity_requires_same_length_vectors():
    assert api.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert api.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_grounded_answer_uses_only_valid_citations(monkeypatch):
    import openai

    captured = {}

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            usage = SimpleNamespace(
                input_tokens=100,
                output_tokens=30,
                total_tokens=130,
                input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0),
            )
            return SimpleNamespace(
                output_parsed=api.GroundedDocumentAnswer(
                    answer="환불이 확정된 달의 조정 항목으로 기록합니다.",
                    citations=[1],
                ),
                usage=usage,
                model="gpt-6-luna",
            )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: SimpleNamespace(responses=FakeResponses()))
    sources = [
        {
            "document_name": "manual.md",
            "chunk_index": 2,
            "content": "환불이 확정된 달의 조정 항목으로 기록합니다.",
            "score": 0.9,
        }
    ]

    answer, citations, usage = api.generate_grounded_answer("환불은 언제 기록해?", sources)

    assert answer == "환불이 확정된 달의 조정 항목으로 기록합니다."
    assert citations == [1]
    assert usage["total_tokens"] == 130
    assert captured["text_format"] is api.GroundedDocumentAnswer
    assert captured["store"] is False
    assert "source 목록의 내용만" in captured["input"][0]["content"]


def test_grounded_answer_returns_no_answer_without_retrieval_source(monkeypatch):
    monkeypatch.setattr(
        api,
        "retrieve_document_sources",
        lambda query, mode: {"query": query, "mode": mode, "sources": []},
    )

    result = api.build_grounded_document_answer("휴가 일정은?", "keyword")

    assert result["citations"] == []
    assert result["usage"] is None
    assert "근거를 찾지 못했습니다" in result["answer"]


def test_grounded_answer_rejects_citation_outside_retrieved_sources(monkeypatch):
    import openai

    class FakeResponses:
        def parse(self, **kwargs):
            return SimpleNamespace(
                output_parsed=api.GroundedDocumentAnswer(answer="답변", citations=[2]),
                usage=None,
                model="gpt-6-luna",
            )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: SimpleNamespace(responses=FakeResponses()))
    sources = [{"document_name": "manual.md", "chunk_index": 1, "content": "근거", "score": 1}]

    with pytest.raises(ValueError, match="근거 번호"):
        api.generate_grounded_answer("질문", sources)


def test_work_agent_calls_sales_tool_then_answers(monkeypatch):
    import openai

    captured = []

    def usage(input_tokens, output_tokens):
        return SimpleNamespace(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0),
        )

    class FakeResponses:
        def __init__(self):
            self.count = 0

        def create(self, **kwargs):
            self.count += 1
            captured.append(kwargs)
            if self.count == 1:
                return SimpleNamespace(
                    id="response-1",
                    output=[
                        SimpleNamespace(
                            type="function_call",
                            name="get_sales_report",
                            arguments="{}",
                            call_id="call-sales",
                        )
                    ],
                    output_text="",
                    usage=usage(50, 10),
                )
            return SimpleNamespace(
                id="response-2",
                output=[],
                output_text="강남점은 지난달보다 늘었습니다.",
                usage=usage(80, 20),
            )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        openai,
        "OpenAI",
        lambda **kwargs: SimpleNamespace(responses=FakeResponses()),
    )

    result = api.run_work_agent("강남점 매출 추세를 알려줘")

    assert result["answer"] == "강남점은 지난달보다 늘었습니다."
    assert result["tool_trace"] == [{"tool": "get_sales_report", "arguments": {}}]
    assert result["usage"]["total_tokens"] == 160
    assert captured[0]["tools"] is api.AGENT_TOOLS
    assert captured[0]["parallel_tool_calls"] is False
    assert "previous_response_id" not in captured[1]
    assert captured[1]["input"][0]["content"] == "강남점 매출 추세를 알려줘"
    assert captured[1]["input"][1].call_id == "call-sales"
    assert captured[1]["input"][2]["call_id"] == "call-sales"


def test_agent_tool_rejects_unknown_tool():
    with pytest.raises(ValueError, match="허용되지 않은 도구"):
        api.execute_agent_tool("delete_everything", {})


def test_agent_document_tool_requires_valid_search_mode():
    with pytest.raises(ValueError, match="검색 방식"):
        api.execute_agent_tool("search_work_documents", {"query": "환불", "mode": "wrong"})
