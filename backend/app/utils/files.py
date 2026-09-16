"""
File management utilities: secure filenames, temp/generated audio dirs,
cleanup of old files.
"""
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger(__name__)


def get_temp_audio_dir() -> Path:
    """Return path to temp audio directory, creating it if needed."""
    settings = get_settings()
    path = Path(settings.temp_audio_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_generated_audio_dir() -> Path:
    """Return path to generated audio directory, creating it if needed."""
    settings = get_settings()
    path = Path(settings.generated_audio_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def generate_unique_filename(prefix: str = "", extension: str = "wav") -> str:
    """Generate a UUID-based filename to prevent collisions."""
    uid = uuid.uuid4().hex
    name = f"{prefix}{uid}.{extension}" if prefix else f"{uid}.{extension}"
    return name


def safe_filename(name: str) -> str:
    """Sanitize a filename, removing path traversal and dangerous characters."""
    # Only take the base name to prevent path traversal
    name = os.path.basename(name)
    # Remove anything that isn't alphanumeric, underscore, hyphen, or dot
    safe = "".join(c for c in name if c.isalnum() or c in ("_", "-", "."))
    return safe or "audio"


def cleanup_old_files(directory: Path, max_age_minutes: int) -> int:
    """
    Delete files in a directory that are older than max_age_minutes.
    Returns the number of files deleted.
    """
    if not directory.exists():
        return 0

    cutoff = time.time() - (max_age_minutes * 60)
    deleted = 0
    for file_path in directory.iterdir():
        if file_path.is_file():
            try:
                if file_path.stat().st_mtime < cutoff:
                    file_path.unlink()
                    deleted += 1
                    logger.debug(f"Cleaned up old file: {file_path.name}")
            except OSError as e:
                logger.warning(f"Could not delete file {file_path}: {e}")

    if deleted:
        logger.info(f"Cleaned up {deleted} old file(s) from {directory}")
    return deleted


def cleanup_file(file_path: Optional[Path]) -> None:
    """Delete a single file if it exists."""
    if file_path and file_path.exists():
        try:
            file_path.unlink()
            logger.debug(f"Deleted temporary file: {file_path.name}")
        except OSError as e:
            logger.warning(f"Could not delete file {file_path}: {e}")
