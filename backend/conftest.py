import pytest
from fastapi.testclient import TestClient

from app import app


# Every test gets its own empty database, so tests can never touch the real library.
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIALIBRARY_DB", str(tmp_path / "test.db"))
    with TestClient(app) as test_client:
        yield test_client
