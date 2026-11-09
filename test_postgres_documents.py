"""Optional integration test: runs only when Docker PostgreSQL is intentionally enabled."""

import os

import pytest

import api
from database import initialize_postgres_schema, open_connection


pytestmark = pytest.mark.skipif(
    os.getenv("WORKBRIEF_RUN_POSTGRES_TESTS") != "1",
    reason="Docker PostgreSQL integration test is opt-in",
)


@pytest.fixture(autouse=True)
def clean_postgres_documents(monkeypatch):
    monkeypatch.setenv("WORKBRIEF_DOCUMENT_STORE", "postgres")
    initialize_postgres_schema()
    with open_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE chunk_embeddings, document_chunks, documents RESTART IDENTITY CASCADE")


def test_postgres_document_save_index_and_semantic_search(monkeypatch):
    document_id = api.save_document(
        "refund.md",
        "test document",
        ["환불이 확정된 달의 조정 항목으로 기록합니다.", "휴가 일정은 인사팀에 문의합니다."],
    )

    def fake_embeddings(texts):
        if len(texts) == 1:
            return "test-embedding", [[1.0, 0.0]]
        return "test-embedding", [[1.0, 0.0], [0.0, 1.0]]

    monkeypatch.setattr(api, "create_embeddings", fake_embeddings)
    indexed = api.index_document_embeddings(document_id)
    results = api.search_semantic_document_chunks("돈을 돌려준 거래는 어디에 기록해?")

    assert indexed["indexed_chunks"] == 2
    assert results["sources"][0]["document_name"] == "refund.md"
    assert results["sources"][0]["score"] == 1.0
