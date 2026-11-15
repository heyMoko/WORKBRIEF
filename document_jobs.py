"""Redis-backed document indexing queue that also runs on Windows."""

import json
import os
from uuid import uuid4

from redis import Redis

QUEUE_NAME = "workbrief-document-index"
MAX_ATTEMPTS = 3


def redis_connection():
    """Open Redis using the local Docker Compose default."""
    return Redis.from_url(
        os.getenv("WORKBRIEF_REDIS_URL", "redis://127.0.0.1:6379/0"),
        socket_connect_timeout=3,
        # BRPOP is meant to wait. A finite socket timeout would kill an idle worker.
        socket_timeout=None,
        decode_responses=True,
    )


def enqueue_document_index(document_id: int, document_owner_id: int):
    """Put a small JSON job onto Redis. JSON stays readable and works on Windows."""
    connection = redis_connection()
    connection.ping()
    job_id = str(uuid4())
    payload = json.dumps({
        "job_id": job_id,
        "document_id": document_id,
        "owner_id": document_owner_id,
        "attempt": 1,
    })
    connection.lpush(QUEUE_NAME, payload)
    return {"job_id": job_id, "queue": QUEUE_NAME, "status": "queued"}


def process_document_index(document_id: int, document_owner_id: int):
    """Run one job. The worker has no browser token, so it receives the owner ID."""
    # Lazy imports avoid api.py -> document_jobs.py -> api.py circular imports.
    from api import index_document_embeddings, set_document_index_status

    set_document_index_status(document_id, document_owner_id, "processing")
    try:
        result = index_document_embeddings(document_id, document_owner_id=document_owner_id)
    except Exception:
        set_document_index_status(
            document_id,
            document_owner_id,
            "failed",
            "AI 색인에 실패했습니다. 잠시 후 다시 요청해주세요.",
        )
        raise
    set_document_index_status(document_id, document_owner_id, "ready")
    return result
