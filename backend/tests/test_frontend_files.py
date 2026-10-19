import asyncio

import httpx
from fastapi import FastAPI

from app.frontend_files import frontend_response


def test_mounted_spa_blocks_encoded_parent_segments(tmp_path):
    root = tmp_path / "dist"
    root.mkdir()
    (root / "index.html").write_text("SPA fixture", encoding="utf8")
    (root / "asset.js").write_text("asset fixture", encoding="utf8")
    (tmp_path / "private.txt").write_text("private synthetic marker", encoding="utf8")
    app = FastAPI()

    @app.get("/{path:path}")
    def frontend(path: str):
        return frontend_response(root, path)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            for path in ("/%2e%2e/private.txt", "/%2e%2e/%2e%2e/private.txt"):
                response = await client.get(path)
                assert response.status_code == 404
                assert "private synthetic marker" not in response.text
            assert (await client.get("/asset.js")).text == "asset fixture"
            assert (await client.get("/applications/fixture")).text == "SPA fixture"

    asyncio.run(check())
