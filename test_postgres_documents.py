"""Opt-in PostgreSQL isolation test. All writes roll back; no API charges."""
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4
import pytest
import api
from database import initialize_postgres_schema, open_connection

pytestmark = pytest.mark.skipif(os.getenv("WORKBRIEF_RUN_POSTGRES_TESTS") != "1", reason="PostgreSQL integration test is opt-in")

def test_two_users_cannot_read_or_index_each_others_documents(monkeypatch):
    initialize_postgres_schema()
    with open_connection() as conn:
        with conn.transaction(force_rollback=True):
            @contextmanager
            def shared_connection():
                yield conn
            monkeypatch.setattr(api, "open_connection", shared_connection)
            monkeypatch.setattr(api, "initialize_postgres_schema", lambda: None)
            monkeypatch.setenv("WORKBRIEF_DOCUMENT_STORE", "postgres")
            ids = []
            for name in ("A", "B"):
                row = conn.execute("INSERT INTO users (email, display_name, password_hash, created_at) VALUES (%s,%s,%s,%s) RETURNING id", (f"{uuid4()}@example.test", name, "not-a-login-hash", datetime.now(timezone.utc))).fetchone()
                ids.append(row["id"])
            monkeypatch.setattr(api, "create_embeddings", lambda texts: ("isolation-test", [[1.0, 0.0] for _ in texts]))
            token = api.request_owner.set(ids[0])
            try:
                doc_a = api.save_document("private-a.txt", "환불 A비밀", ["환불 A비밀"])
                api.index_document_embeddings(doc_a)
                api.request_owner.set(ids[1])
                doc_b = api.save_document("private-b.txt", "환불 B비밀", ["환불 B비밀"])
                api.index_document_embeddings(doc_b)
                assert [x["document_name"] for x in api.search_document_chunks("환불")["sources"]] == ["private-b.txt"]
                assert [x["document_name"] for x in api.search_semantic_document_chunks("환불")["sources"]] == ["private-b.txt"]
                with pytest.raises(api.HTTPException) as exc:
                    api.index_document_embeddings(doc_a)
                assert exc.value.status_code == 404
                api.request_owner.set(ids[0])
                assert [x["document_name"] for x in api.search_document_chunks("환불")["sources"]] == ["private-a.txt"]
            finally:
                api.request_owner.reset(token)
