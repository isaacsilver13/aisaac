from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse


def frontend_response(root: Path, path: str) -> FileResponse:
    """Serve assets/SPA routes without following traversal or escaping symlinks."""
    root = root.resolve()
    try:
        requested = (root / path).resolve()
    except (OSError, ValueError):
        raise HTTPException(404, "Not found") from None
    if not requested.is_relative_to(root):
        raise HTTPException(404, "Not found")
    if path and requested.is_file():
        return FileResponse(requested)
    return FileResponse(root / "index.html")
