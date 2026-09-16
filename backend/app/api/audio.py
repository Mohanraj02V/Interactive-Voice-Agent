"""
Audio file retrieval endpoint.
"""
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.utils.files import get_generated_audio_dir, safe_filename
from app.utils.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/audio/{filename}")
async def get_audio(filename: str) -> FileResponse:
    """
    Retrieve a generated audio file by filename.
    Only serves files from the generated_audio directory.
    """
    # Sanitize to prevent path traversal
    safe_name = safe_filename(filename)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename")

    audio_dir = get_generated_audio_dir()
    file_path = audio_dir / safe_name

    if not file_path.exists():
        logger.warning(f"Audio file not found: {safe_name}")
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Ensure it's within the audio directory (double-check)
    try:
        file_path.resolve().relative_to(audio_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    return FileResponse(
        path=str(file_path),
        media_type="audio/wav",
        headers={"Content-Disposition": f"inline; filename={safe_name}"},
    )
