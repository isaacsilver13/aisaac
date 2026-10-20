import pytest

from app import personal_sports


@pytest.fixture(autouse=True)
def no_live_providers(monkeypatch):
    """Tests never reach ESPN; a test that wants a provider passes one explicitly."""
    monkeypatch.setattr(personal_sports, "PROVIDER", None)
