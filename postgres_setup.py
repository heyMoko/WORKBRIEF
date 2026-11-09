"""Create and verify the WorkBrief PostgreSQL schema from the terminal."""

from database import initialize_postgres_schema, inspect_postgres


if __name__ == "__main__":
    initialize_postgres_schema()
    status = inspect_postgres()
    print(f"데이터베이스: {status['database']}")
    print(f"pgvector 활성화: {status['vector_enabled']}")
    print("생성된 표: " + ", ".join(status["tables"]))
