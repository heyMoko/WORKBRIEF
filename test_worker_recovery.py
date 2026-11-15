"""Recovery behavior with a small in-memory Redis stand-in; no network calls."""
import json
import worker

class FakeRedis:
    def __init__(self):
        self.lists = {worker.QUEUE_NAME: [], worker.PROCESSING_QUEUE: []}
    def rpoplpush(self, source, dest):
        if not self.lists[source]: return None
        value = self.lists[source].pop()
        self.lists[dest].insert(0, value)
        return value
    def lpush(self, key, value): self.lists[key].insert(0, value); return self
    def lrem(self, key, count, value): self.lists[key].remove(value); return self
    def pipeline(self, transaction=True): return self
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self): pass

def test_interrupted_job_returns_to_queue_and_is_acknowledged(monkeypatch):
    redis = FakeRedis()
    job = json.dumps({'document_id': 12, 'owner_id': 4, 'attempt': 1})
    redis.lpush(worker.PROCESSING_QUEUE, job)
    assert worker.recover_interrupted_jobs(redis) == 1
    assert redis.lists[worker.QUEUE_NAME] == [job]
    redis.rpoplpush(worker.QUEUE_NAME, worker.PROCESSING_QUEUE)
    monkeypatch.setattr(worker, 'process_document_index', lambda doc, owner: {'indexed_chunks': 2})
    worker.process_one(redis, job)
    assert redis.lists[worker.PROCESSING_QUEUE] == []
    assert redis.lists[worker.QUEUE_NAME] == []

def test_failed_job_requeued_with_incremented_attempt(monkeypatch):
    redis = FakeRedis()
    job = json.dumps({'document_id': 12, 'owner_id': 4, 'attempt': 1})
    redis.lpush(worker.PROCESSING_QUEUE, job)
    def fail(*args): raise RuntimeError('test')
    monkeypatch.setattr(worker, 'process_document_index', fail)
    monkeypatch.setattr(worker.time, 'sleep', lambda seconds: None)
    worker.process_one(redis, job)
    assert redis.lists[worker.PROCESSING_QUEUE] == []
    assert json.loads(redis.lists[worker.QUEUE_NAME][0])['attempt'] == 2
