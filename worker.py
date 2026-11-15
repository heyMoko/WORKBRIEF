"""Windows-compatible WorkBrief worker. Run: python worker.py"""

import json
import time

from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError
from document_jobs import MAX_ATTEMPTS, QUEUE_NAME, process_document_index, redis_connection


def retry_or_mark_failed(connection, job, error):
    """Retry a temporary failure twice; keep the user-facing status honest."""
    attempt = job["attempt"]
    print(f"[Worker] 문서 {job['document_id']} 처리 실패 ({attempt}/{MAX_ATTEMPTS}): {type(error).__name__}: {error}")
    if attempt < MAX_ATTEMPTS:
        job["attempt"] += 1
        time.sleep(3 * attempt)
        connection.lpush(QUEUE_NAME, json.dumps(job))
        print(f"[Worker] 다시 대기열에 넣었습니다: 문서 {job['document_id']}")


def run_worker():
    connection = redis_connection()
    connection.ping()
    print(f"[Worker] Redis에 연결됐어요. '{QUEUE_NAME}' 대기열을 기다립니다. Ctrl+C로 종료합니다.")

    while True:
        try:
            # timeout=0 means wait forever. This is a normal idle state, not an error.
            queued_item = connection.brpop(QUEUE_NAME, timeout=0)
        except RedisTimeoutError:
            # Some Windows socket setups still impose a read timeout. Keep waiting quietly.
            continue
        except RedisConnectionError as error:
            print(f"[Worker] Redis 연결이 끊겼어요: {error}. 3초 뒤 다시 연결합니다.")
            time.sleep(3)
            connection = redis_connection()
            continue
        if queued_item is None:
            continue
        _, raw_job = queued_item
        job = json.loads(raw_job)
        print(f"[Worker] 문서 {job['document_id']} AI 의미 검색 준비를 시작합니다.")
        try:
            result = process_document_index(job["document_id"], job["owner_id"])
            print(f"[Worker] 완료: 문서 {job['document_id']} · {result['indexed_chunks']}개 문단")
        except Exception as error:
            retry_or_mark_failed(connection, job, error)


if __name__ == "__main__":
    try:
        run_worker()
    except KeyboardInterrupt:
        print("\n[Worker] 종료했습니다.")
