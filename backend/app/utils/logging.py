"""
Structured application logging configuration.
"""
import logging
import sys
from typing import Optional

from app.config import get_settings


def setup_logging() -> logging.Logger:
    """Configure and return the application logger."""
    settings = get_settings()

    log_level = logging.DEBUG if settings.debug else logging.INFO

    # Create formatter
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler — force UTF-8 on Windows to avoid cp1252 UnicodeEncodeError
    import io
    stream = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace') \
        if hasattr(sys.stdout, 'buffer') else sys.stdout
    console_handler = logging.StreamHandler(stream)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.handlers.clear()
    root_logger.addHandler(console_handler)

    # Suppress noisy debug logs from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    return root_logger


def get_logger(name: str) -> logging.Logger:
    """Get a named logger for a module."""
    return logging.getLogger(name)
