import pytest

from app import main, personal_sports


@pytest.fixture(autouse=True)
def no_live_providers(monkeypatch):
    """Tests never reach ESPN or GitHub; a test that wants a provider passes one explicitly."""
    monkeypatch.setattr(personal_sports, "PROVIDER", None)

    async def no_activity():
        return []

    monkeypatch.setattr(main, "_repo_activity", no_activity)
