"""Opt-in Redis integration tests, isolated by unique queue keys."""
import json
import os
from uuid import uuid4

import pytest
from redis import Redis
import worker

pytestmark = pytest.mark.skipif(os.getenv('WORKBRIEF_TEST_REDIS') != '1', reason='Redis integration test is opt-in')

@pytest.fixture
def queues(monkeypatch):
    redis = Redis.from_url(os.getenv('WORKBRIEF_TEST_REDIS_URL', 'redis://127.0.0.1:6379/0'), decode_responses=True, socket_connect_timeout=3)
    suffix = uuid4().hex
    waiting = f'workbrief:test:{suffix}:waiting'
    processing = f'workbrief:test:{suffix}:processing'
    monkeypatch.setattr(worker, 'QUEUE_NAME', waiting)
    monkeypatch.setattr(worker, 'PROCESSING_QUEUE', processing)
    try:
        redis.ping()
        yield redis, waiting, processing
    finally:
        redis.delete(waiting, processing)
        redis.close()


def test_real_redis_recovers_interrupted_job(queues, monkeypatch):
    redis, waiting, processing = queues
    raw = json.dumps({'job_id': 'integration', 'document_id': 18, 'owner_id': 1, 'attempt': 1})
    redis.lpush(waiting, raw)
    assert redis.brpoplpush(waiting, processing, timeout=1) == raw
    assert worker.recover_interrupted_jobs(redis) == 1
    assert redis.llen(processing) == 0
    assert redis.brpoplpush(waiting, processing, timeout=1) == raw
    calls = []
    monkeypatch.setattr(worker, 'process_document_index', lambda doc, owner: calls.append((doc, owner)) or {'indexed_chunks': 1})
    worker.process_one(redis, raw)
    assert calls == [(18, 1)]
    assert redis.llen(waiting) == redis.llen(processing) == 0


def test_real_redis_requeues_failed_job(queues, monkeypatch):
    redis, waiting, processing = queues
    raw = json.dumps({'document_id': 18, 'owner_id': 1, 'attempt': 1})
    redis.lpush(processing, raw)
    def fail(*args): raise RuntimeError('simulated failure')
    monkeypatch.setattr(worker, 'process_document_index', fail)
    monkeypatch.setattr(worker.time, 'sleep', lambda _: None)
    worker.process_one(redis, raw)
    assert redis.llen(processing) == 0
    assert json.loads(redis.rpop(waiting))['attempt'] == 2
