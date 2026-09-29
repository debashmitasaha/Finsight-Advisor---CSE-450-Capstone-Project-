from app.database import DEFAULT_SQLITE_PATH, resolve_database_url


def test_database_url_takes_precedence(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/finsight")
    monkeypatch.setenv("LOCAL_DATABASE_URL", "sqlite:///ignored.db")

    assert resolve_database_url() == "postgresql://example.invalid/finsight"


def test_blank_database_url_uses_local_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "  ")
    monkeypatch.setenv("LOCAL_DATABASE_URL", "sqlite:///local.db")

    assert resolve_database_url() == "sqlite:///local.db"


def test_missing_database_urls_use_backend_sqlite_file(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LOCAL_DATABASE_URL", raising=False)

    assert resolve_database_url() == f"sqlite:///{DEFAULT_SQLITE_PATH.as_posix()}"
