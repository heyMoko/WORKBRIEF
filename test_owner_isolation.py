"""Authentication gates and owner propagation; no live DB or paid AI calls."""
from contextlib import contextmanager
import pytest
from fastapi.testclient import TestClient
import api

@pytest.mark.parametrize("method,path,kwargs", [
    ("get", "/documents/search", {"params": {"query": "환불"}}),
    ("post", "/documents/upload", {}),
    ("post", "/documents/1/index", {}),
    ("post", "/documents/answer", {"json": {"query": "환불"}}),
    ("post", "/agent/answer", {"json": {"question": "환불"}}),
    ("get", "/agent/traces", {}),
    ("get", "/report/usage", {}),
])
def test_anonymous_request_is_rejected(method, path, kwargs):
    with TestClient(api.app) as client:
        assert getattr(client, method)(path, **kwargs).status_code == 401

def test_owner_context_reaches_agent_thread_and_resets(monkeypatch):
    monkeypatch.setattr(api, "current_user_from_token", lambda token: {"id": int(token)})
    monkeypatch.setattr(api, "run_work_agent", lambda question: {"owner": api.owner_id()})
    monkeypatch.setattr(api, "save_agent_trace", lambda result: None)
    with TestClient(api.app) as client:
        for user in (11, 22):
            response = client.post("/agent/answer", headers={"Authorization": f"Bearer {user}"}, json={"question": "환불"})
            assert response.json() == {"owner": user}
    assert api.request_owner.get() is None

def test_other_owner_cannot_index_document_or_call_embeddings(monkeypatch):
    monkeypatch.setenv("WORKBRIEF_DOCUMENT_STORE", "postgres")
    monkeypatch.setattr(api, "initialize_postgres_schema", lambda: None)
    calls = []
    class Cursor:
        def execute(self, sql, params):
            calls.append((sql, params))
        def fetchall(self):
            return []
    @contextmanager
    def fake_cursor():
        yield Cursor()
    class Connection:
        cursor = staticmethod(fake_cursor)
    @contextmanager
    def connection():
        yield Connection()
    monkeypatch.setattr(api, "open_connection", connection)
    monkeypatch.setattr(api, "create_embeddings", lambda texts: pytest.fail("must not call AI"))
    token = api.request_owner.set(22)
    try:
        with pytest.raises(api.HTTPException) as exc:
            api.index_document_embeddings(99)
        assert exc.value.status_code == 404
        assert calls[0][1] == (99, 22)
        assert "owner_id = %s" in calls[0][0]
    finally:
        api.request_owner.reset(token)
