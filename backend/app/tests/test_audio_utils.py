"""
Tests for audio utility functions.
"""
import io
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from app.utils.audio import AudioValidationError, detect_extension, save_upload
from app.utils.files import generate_unique_filename, safe_filename


class TestDetectExtension:
    """Tests for MIME type and extension detection."""

    def test_webm_content_type(self):
        assert detect_extension("audio/webm", None) == "webm"

    def test_webm_with_codecs(self):
        assert detect_extension("audio/webm;codecs=opus", None) == "webm"

    def test_ogg_content_type(self):
        assert detect_extension("audio/ogg", None) == "ogg"

    def test_wav_content_type(self):
        assert detect_extension("audio/wav", None) == "wav"

    def test_mp3_content_type(self):
        assert detect_extension("audio/mpeg", None) == "mp3"

    def test_fallback_from_filename(self):
        assert detect_extension(None, "recording.mp3") == "mp3"

    def test_fallback_to_webm(self):
        assert detect_extension(None, None) == "webm"

    def test_unknown_mime_falls_back_to_filename(self):
        # When content type is None, fall back to filename extension
        assert detect_extension(None, "audio.ogg") == "ogg"

    def test_octet_stream_maps_to_webm(self):
        # application/octet-stream is in the MIME map as a fallback to webm
        assert detect_extension("application/octet-stream", "audio.ogg") == "webm"


class TestSafeFilename:
    """Tests for filename sanitization."""

    def test_normal_filename(self):
        assert safe_filename("recording.wav") == "recording.wav"

    def test_path_traversal_prevented(self):
        result = safe_filename("../../etc/passwd")
        assert ".." not in result
        assert "/" not in result

    def test_dangerous_characters_removed(self):
        result = safe_filename("file<script>.wav")
        assert "<" not in result
        assert ">" not in result

    def test_empty_filename(self):
        assert safe_filename("") == "audio"

    def test_uuid_filename(self):
        name = generate_unique_filename(prefix="response_", extension="wav")
        assert name.startswith("response_")
        assert name.endswith(".wav")


class TestSaveUpload:
    """Tests for save_upload function."""

    @pytest.mark.asyncio
    async def test_oversized_file_rejected(self):
        """Files exceeding max size should be rejected."""
        from app.config import get_settings
        settings = get_settings()
        max_bytes = settings.max_audio_size_bytes

        mock_file = AsyncMock()
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"

        # Simulate reading oversized data
        oversized_chunk = b"x" * (max_bytes + 1)
        mock_file.read = AsyncMock(side_effect=[oversized_chunk, b""])

        with pytest.raises(AudioValidationError, match="exceeds maximum"):
            await save_upload(mock_file)

    @pytest.mark.asyncio
    async def test_empty_file_rejected(self):
        """Empty files should be rejected."""
        mock_file = AsyncMock()
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"")

        with pytest.raises(AudioValidationError, match="empty"):
            await save_upload(mock_file)
