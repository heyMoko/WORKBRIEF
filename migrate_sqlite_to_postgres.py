"""One-time, repeat-safe import from WorkBrief's old local SQLite file."""

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from database import initialize_postgres_schema, open_connection


SQLITE_FILE = Path(__file__).with_name("workbrief.db")


def table_exists(connection, table_name):
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table_name,)
    ).fetchone() is not None


def vector_literal(vector_json):
    values = json.loads(vector_json)
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def migrate(sqlite_file=SQLITE_FILE):
    sqlite_file = Path(sqlite_file)
    if not sqlite_file.exists():
        raise FileNotFoundError(f"SQLite 파일을 찾지 못했습니다: {sqlite_file}")

    source_name = str(sqlite_file.resolve())
    initialize_postgres_schema()
    with open_connection() as postgres:
        with postgres.cursor() as cursor:
            cursor.execute("SELECT 1 FROM legacy_imports WHERE source_name = %s", (source_name,))
            if cursor.fetchone():
                return {"already_imported": True, "documents": 0, "chunks": 0, "embeddings": 0, "usage": 0, "traces": 0}

            with sqlite3.connect(sqlite_file) as sqlite:
                sqlite.row_factory = sqlite3.Row
                counts = {"documents": 0, "chunks": 0, "embeddings": 0, "usage": 0, "traces": 0}
                document_ids, chunk_ids = {}, {}

                if table_exists(sqlite, "documents"):
                    for row in sqlite.execute("SELECT id, original_name, content, created_at FROM documents ORDER BY id"):
                        cursor.execute(
                            "SELECT id FROM documents WHERE original_name = %s AND content = %s ORDER BY id LIMIT 1",
                            (row["original_name"], row["content"]),
                        )
                        existing = cursor.fetchone()
                        if existing:
                            document_ids[row["id"]] = existing["id"]
                            continue
                        cursor.execute(
                            "INSERT INTO documents (original_name, content, created_at) VALUES (%s, %s, %s) RETURNING id",
                            (row["original_name"], row["content"], row["created_at"]),
                        )
                        document_ids[row["id"]] = cursor.fetchone()["id"]
                        counts["documents"] += 1

                if table_exists(sqlite, "document_chunks"):
                    for row in sqlite.execute("SELECT id, document_id, chunk_index, content FROM document_chunks ORDER BY id"):
                        new_document_id = document_ids.get(row["document_id"])
                        if new_document_id is None:
                            continue
                        cursor.execute(
                            "SELECT id FROM document_chunks WHERE document_id = %s AND chunk_index = %s AND content = %s",
                            (new_document_id, row["chunk_index"], row["content"]),
                        )
                        existing = cursor.fetchone()
                        if existing:
                            chunk_ids[row["id"]] = existing["id"]
                            continue
                        cursor.execute(
                            "INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (%s, %s, %s) RETURNING id",
                            (new_document_id, row["chunk_index"], row["content"]),
                        )
                        chunk_ids[row["id"]] = cursor.fetchone()["id"]
                        counts["chunks"] += 1

                if table_exists(sqlite, "chunk_embeddings"):
                    for row in sqlite.execute("SELECT chunk_id, model, vector_json, dimensions, created_at FROM chunk_embeddings"):
                        new_chunk_id = chunk_ids.get(row["chunk_id"])
                        if new_chunk_id is None:
                            continue
                        cursor.execute(
                            """
                            INSERT INTO chunk_embeddings (chunk_id, model, embedding, dimensions, created_at)
                            VALUES (%s, %s, %s::vector, %s, %s)
                            ON CONFLICT (chunk_id) DO UPDATE SET
                                model = EXCLUDED.model,
                                embedding = EXCLUDED.embedding,
                                dimensions = EXCLUDED.dimensions,
                                created_at = EXCLUDED.created_at
                            """,
                            (new_chunk_id, row["model"], vector_literal(row["vector_json"]), row["dimensions"], row["created_at"]),
                        )
                        counts["embeddings"] += 1

                if table_exists(sqlite, "ai_usage"):
                    rows = sqlite.execute("SELECT created_at, model, input_tokens, output_tokens, total_tokens, elapsed_ms, estimated_cost_usd FROM ai_usage")
                    for row in rows:
                        cursor.execute(
                            "INSERT INTO ai_usage (created_at, model, input_tokens, output_tokens, total_tokens, elapsed_ms, estimated_cost_usd) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            tuple(row),
                        )
                        counts["usage"] += 1

                if table_exists(sqlite, "agent_traces"):
                    rows = sqlite.execute("SELECT created_at, tools_json, model, total_tokens, elapsed_ms, estimated_cost_usd FROM agent_traces")
                    for row in rows:
                        cursor.execute(
                            "INSERT INTO agent_traces (created_at, tools_json, model, total_tokens, elapsed_ms, estimated_cost_usd) VALUES (%s, %s::jsonb, %s, %s, %s, %s)",
                            tuple(row),
                        )
                        counts["traces"] += 1

            cursor.execute(
                "INSERT INTO legacy_imports (source_name, completed_at) VALUES (%s, %s)",
                (source_name, datetime.now(timezone.utc).isoformat(timespec="seconds")),
            )
    return {"already_imported": False, **counts}


if __name__ == "__main__":
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SQLITE_FILE
    result = migrate(source)
    if result["already_imported"]:
        print("이미 이 SQLite 파일을 PostgreSQL로 옮겼습니다. 중복 복사는 하지 않았어요.")
    else:
        print("SQLite → PostgreSQL 이사 완료")
        print("문서: {documents}, 문단: {chunks}, 임베딩: {embeddings}, AI 사용량: {usage}, Trace: {traces}".format(**result))
