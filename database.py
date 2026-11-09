"""PostgreSQL connection and schema helpers for WorkBrief.

This module is intentionally separate from api.py.  It lets us verify the new
server before moving existing SQLite features one by one.
"""

import os
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv
from psycopg import connect
from psycopg.rows import dict_row

PROJECT_DIR = Path(__file__).parent


def load_database_environment():
    """Read local .env values without putting them in source code."""
    load_dotenv(PROJECT_DIR / ".env")


def database_url():
    """Build a safe local PostgreSQL address from private .env values."""
    load_database_environment()
    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError(".env에 POSTGRES_PASSWORD를 설정해주세요.")

    user = os.getenv("POSTGRES_USER", "workbrief")
    database = os.getenv("POSTGRES_DB", "workbrief")
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    return f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{quote(database)}"


def open_connection():
    """Open one short-lived connection to the local PostgreSQL server."""
    return connect(database_url(), connect_timeout=5, row_factory=dict_row)


def initialize_postgres_schema():
    """Create WorkBrief tables. Running this again is safe."""
    statements = [
        "CREATE EXTENSION IF NOT EXISTS vector",
        """
        CREATE TABLE IF NOT EXISTS legacy_imports (
            source_name TEXT PRIMARY KEY,
            completed_at TIMESTAMPTZ NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ai_usage (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            estimated_cost_usd DOUBLE PRECISION
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS agent_traces (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL,
            tools_json JSONB NOT NULL,
            model TEXT NOT NULL,
            total_tokens INTEGER NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            estimated_cost_usd DOUBLE PRECISION
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS documents (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            original_name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS document_chunks (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            UNIQUE (document_id, chunk_index)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
            chunk_id BIGINT PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            embedding vector NOT NULL,
            dimensions INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
        """,
    ]
    with open_connection() as connection:
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)


def inspect_postgres():
    """Return only safe setup facts; never return the password or full URL."""
    with open_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT current_database() AS database_name,
                       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS vector_enabled
                """
            )
            database = cursor.fetchone()
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
                """
            )
            tables = [row["table_name"] for row in cursor.fetchall()]
    return {"database": database["database_name"], "vector_enabled": database["vector_enabled"], "tables": tables}
