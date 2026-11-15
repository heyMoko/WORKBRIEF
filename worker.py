"""WorkBrief single-worker queue with recovery after a process restart."""
import json
import time

from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError
from document_jobs import MAX_ATTEMPTS, QUEUE_NAME, process_document_index, redis_connection

PROCESSING_QUEUE = QUEUE_NAME + ':processing'


def recover_interrupted_jobs(connection):
    """Return interrupted work to the waiting queue, one atomic move at a time."""
    count = 0
    while connection.rpoplpush(PROCESSING_QUEUE, QUEUE_NAME) is not None:
        count += 1
    return count


def process_one(connection, raw_job):
    """Acknowledge only after success; queue retry and remove old job atomically."""
    try:
        job = json.loads(raw_job)
        document_id = int(job['document_id'])
        owner_id = int(job['owner_id'])
        attempt = int(job.get('attempt', 1))
    except (ValueError, TypeError, KeyError):
        print('[Worker] 잘못된 작업을 제외했습니다.', flush=True)
        connection.lrem(PROCESSING_QUEUE, 1, raw_job)
        return
    print(f'[Worker] 문서 {document_id} 처리 시작 (시도 {attempt})', flush=True)
    try:
        result = process_document_index(document_id, owner_id)
    except Exception as error:
        # Log only the exception class: network errors may contain API keys.
        print(f'[Worker] 처리 실패: {type(error).__name__}', flush=True)
        if attempt < MAX_ATTEMPTS:
            job['attempt'] = attempt + 1
            time.sleep(3 * attempt)
            with connection.pipeline(transaction=True) as pipe:
                pipe.lpush(QUEUE_NAME, json.dumps(job))
                pipe.lrem(PROCESSING_QUEUE, 1, raw_job)
                pipe.execute()
        else:
            connection.lrem(PROCESSING_QUEUE, 1, raw_job)
        return
    connection.lrem(PROCESSING_QUEUE, 1, raw_job)
    print(f"[Worker] 완료: 문서 {document_id} · {result['indexed_chunks']}개 문단", flush=True)


def run_worker():
    connection = redis_connection()
    connection.ping()
    recovered = recover_interrupted_jobs(connection)
    print(f'[Worker] 연결 완료. 중단된 작업 {recovered}개 복구. 대기 중...', flush=True)
    while True:
        try:
            raw_job = connection.brpoplpush(QUEUE_NAME, PROCESSING_QUEUE, timeout=5)
            if raw_job is not None:
                process_one(connection, raw_job)
        except (RedisConnectionError, RedisTimeoutError):
            print('[Worker] Redis 연결 중단. 3초 뒤 재연결합니다.', flush=True)
            time.sleep(3)
            connection = redis_connection()
            try:
                recover_interrupted_jobs(connection)
            except (RedisConnectionError, RedisTimeoutError):
                pass


if __name__ == '__main__':
    try:
        run_worker()
    except KeyboardInterrupt:
        print('\n[Worker] 종료했습니다.')
