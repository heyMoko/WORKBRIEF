from urllib.parse import quote

import pytest

import database


def test_database_url_uses_local_env_values(monkeypatch):
    monkeypatch.setattr(database, "load_database_environment", lambda: None)
    monkeypatch.setenv("POSTGRES_USER", "work brief")
    monkeypatch.setenv("POSTGRES_PASSWORD", "a password@home")
    monkeypatch.setenv("POSTGRES_DB", "workbrief")
    monkeypatch.setenv("POSTGRES_HOST", "127.0.0.1")
    monkeypatch.setenv("POSTGRES_PORT", "5432")

    assert database.database_url() == (
        f"postgresql://{quote('work brief')}:{quote('a password@home')}@127.0.0.1:5432/workbrief"
    )


def test_database_url_requires_password(monkeypatch):
    monkeypatch.setattr(database, "load_database_environment", lambda: None)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="POSTGRES_PASSWORD"):
        database.database_url()
