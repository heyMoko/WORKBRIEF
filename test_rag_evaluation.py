"""RAG retrieval evaluation: the same questions are used before and after search changes."""

import pytest

import api
from rag_evaluation import EVALUATION_MANUAL, RETRIEVAL_EVALUATION_CASES


@pytest.fixture
def prepared_manual(tmp_path, monkeypatch):
    """Put the fixed evaluation manual into a fresh temporary database."""
    monkeypatch.setattr(api, "DB_FILE", tmp_path / "workbrief.db")
    chunks = api.split_document_into_chunks(EVALUATION_MANUAL)
    api.save_document("evaluation_manual.md", EVALUATION_MANUAL, chunks)


@pytest.mark.parametrize("case", RETRIEVAL_EVALUATION_CASES, ids=lambda case: case.name)
def test_keyword_retrieval_finds_expected_evidence(prepared_manual, case):
    """A pass means the first result contains the evidence expected for this question."""
    result = api.search_document_chunks(case.question)

    assert result["sources"], f"'{case.name}' 질문에서 근거를 찾지 못했습니다."
    assert case.expected_phrase in result["sources"][0]["content"]
