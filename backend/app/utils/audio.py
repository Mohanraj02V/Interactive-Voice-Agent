"""
Audio file validation and handling utilities.
"""
import os
import shutil
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from app.config import get_settings
from app.utils.files import generate_unique_filename, get_temp_audio_dir
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Allowed audio MIME types
ALLOWED_MIME_TYPES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "application/octet-stream",  # fallback when browser doesn't set type
}

# Extension map from MIME type
MIME_TO_EXTENSION = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/ogg": "ogg",
    "audio/ogg;codecs=opus": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "application/octet-stream": "webm",  # default fallback
}


class AudioValidationError(Exception):
    """Raised when audio validation fails."""
    pass


def detect_extension(content_type: Optional[str], filename: Optional[str]) -> str:
    """
    Detect the best file extension from content type or filename.
    Falls back to 'webm' if nothing matched.
    """
    if content_type:
        # Normalize: lowercase, strip whitespace
        ct = content_type.lower().strip()
        if ct in MIME_TO_EXTENSION:
            return MIME_TO_EXTENSION[ct]

    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
        if ext in ("webm", "wav", "mp3", "ogg", "m4a", "mp4"):
            return ext

    return "webm"


def validate_audio_file(file: UploadFile) -> str:
    """
    Read and validate an uploaded audio file.
    Returns detected_extension.
    Raises AudioValidationError on failure.
    """
    content_type = file.content_type or ""
    filename = file.filename or ""

    # Normalize content type (strip codec params for comparison)
    normalized_ct = content_type.lower().split(";")[0].strip()
    # Check if mime is broadly acceptable
    if content_type and normalized_ct not in {
        "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav",
        "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a",
        "audio/x-m4a", "application/octet-stream", "video/webm",
    }:
        logger.warning(f"Unexpected content type: {content_type}")
        # Don't reject — browser MIME types vary widely; log and continue

    extension = detect_extension(content_type, filename)
    return extension


async def save_upload(file: UploadFile) -> Tuple[Path, str]:
    """
    Save an uploaded audio file to the temp directory securely.
    Returns (saved_path, extension).
    Raises AudioValidationError on failure.
    """
    settings = get_settings()
    extension = validate_audio_file(file)
    temp_dir = get_temp_audio_dir()
    safe_name = generate_unique_filename(prefix="upload_", extension=extension)
    save_path = temp_dir / safe_name

    # Read and write in chunks to limit memory usage and enforce size limit
    bytes_written = 0
    with open(save_path, "wb") as out_file:
        while True:
            chunk = await file.read(65536)  # 64 KB chunks
            if not chunk:
                break
            bytes_written += len(chunk)
            if bytes_written > settings.max_audio_size_bytes:
                out_file.close()
                save_path.unlink(missing_ok=True)
                raise AudioValidationError(
                    f"Audio file exceeds maximum size of {settings.max_audio_size_mb} MB"
                )
            out_file.write(chunk)

    if bytes_written == 0:
        save_path.unlink(missing_ok=True)
        raise AudioValidationError("Uploaded audio file is empty")

    logger.debug(f"Saved upload: {safe_name} ({bytes_written} bytes, type={extension})")
    return save_path, extension
