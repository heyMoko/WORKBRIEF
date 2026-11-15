"""Real PostgreSQL + Redis, fake embedding: isolated test data only."""
import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
import api
import database
import document_jobs
import worker

pytestmark = pytest.mark.skipif(os.getenv('WORKBRIEF_TEST_STACK') != '1', reason='isolated stack test is opt-in')


def test_upload_worker_and_semantic_search(monkeypatch):
    monkeypatch.setenv('WORKBRIEF_DOCUMENT_STORE', 'postgres')
    suffix = uuid4().hex
    waiting = f'workbrief:test:{suffix}:waiting'
    processing = f'workbrief:test:{suffix}:processing'
    monkeypatch.setattr(document_jobs, 'QUEUE_NAME', waiting)
    monkeypatch.setattr(worker, 'QUEUE_NAME', waiting)
    monkeypatch.setattr(worker, 'PROCESSING_QUEUE', processing)
    monkeypatch.setattr(api, 'create_embeddings', lambda texts: ('test-model', [[1.0, 0.0] for _ in texts]))
    database.initialize_postgres_schema()
    redis = document_jobs.redis_connection()
    user_id = None
    doc_id = None
    try:
        with database.open_connection() as conn:
            user_id = conn.execute(
                'INSERT INTO users (email, display_name, password_hash, created_at) VALUES (%s,%s,%s,%s) RETURNING id',
                (f'{suffix}@example.test', 'Test', 'not-a-login-hash', datetime.now(timezone.utc)),
            ).fetchone()['id']
        async def fake_auth():
            token = api.request_owner.set(user_id)
            try: yield
            finally: api.request_owner.reset(token)
        monkeypatch.setitem(api.app.dependency_overrides, api.authenticated_owner, fake_auth)
        with TestClient(api.app) as client:
            response = client.post('/documents/upload', files={'file': ('test.txt', '당일 취소 거래는 매출에서 제외합니다.'.encode(), 'text/plain')})
            assert response.status_code == 200, response.text
            doc_id = response.json()['document_id']
            raw = redis.brpoplpush(waiting, processing, timeout=2)
            assert raw is not None
            worker.process_one(redis, raw)
            status = client.get(f'/documents/{doc_id}/status')
            assert status.json()['index_status'] == 'ready'
            with database.open_connection() as conn:
                row = conn.execute('SELECT COUNT(*) AS n FROM chunk_embeddings e JOIN document_chunks c ON e.chunk_id=c.id WHERE c.document_id=%s', (doc_id,)).fetchone()
                assert row['n'] == 1
            result = client.get('/documents/search', params={'query': '취소 거래', 'mode': 'semantic'})
            assert result.status_code == 200, result.text
            assert any(source['document_name'] == 'test.txt' for source in result.json()['sources'])
            assert redis.llen(waiting) == redis.llen(processing) == 0
    finally:
        redis.delete(waiting, processing)
        redis.close()
        if user_id is not None:
            with database.open_connection() as conn:
                conn.execute('DELETE FROM documents WHERE owner_id=%s', (user_id,))
                conn.execute('DELETE FROM users WHERE id=%s', (user_id,))
