"""
Tests for API response schemas.
"""
import pytest
from pydantic import ValidationError

from app.schemas import (
    ConversationMessage,
    ErrorDetail,
    HealthStatus,
    VoiceChatResponse,
)


class TestConversationMessage:
    def test_valid_user_message(self):
        msg = ConversationMessage(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"

    def test_valid_assistant_message(self):
        msg = ConversationMessage(role="assistant", content="Hi there!")
        assert msg.role == "assistant"

    def test_missing_role_raises(self):
        with pytest.raises(ValidationError):
            ConversationMessage(content="Hello")

    def test_missing_content_raises(self):
        with pytest.raises(ValidationError):
            ConversationMessage(role="user")


class TestErrorDetail:
    def test_error_detail_schema(self):
        err = ErrorDetail(code="TEST_ERROR", message="Something failed")
        assert err.code == "TEST_ERROR"
        assert err.message == "Something failed"


class TestVoiceChatResponse:
    def test_success_response(self):
        resp = VoiceChatResponse(
            success=True,
            transcript="What is Python?",
            response="Python is a programming language.",
            audio_url="/api/audio/response_abc123.wav",
        )
        assert resp.success is True
        assert resp.transcript == "What is Python?"
        assert resp.audio_url is not None

    def test_error_response(self):
        resp = VoiceChatResponse(
            success=False,
            error=ErrorDetail(
                code="TRANSCRIPTION_FAILED",
                message="Unable to transcribe audio",
            ),
        )
        assert resp.success is False
        assert resp.error is not None
        assert resp.error.code == "TRANSCRIPTION_FAILED"

    def test_partial_success_no_audio(self):
        """Response is valid even when audio_url is None (TTS failed)."""
        resp = VoiceChatResponse(
            success=True,
            transcript="Hello",
            response="Hi there!",
            audio_url=None,
        )
        assert resp.success is True
        assert resp.audio_url is None


class TestHealthStatus:
    def test_all_services_available(self):
        status = HealthStatus(
            status="ok",
            ollama=True,
            whisper=True,
            tts=True,
            ollama_model="qwen2.5:3b",
            whisper_model="base",
        )
        assert status.status == "ok"
        assert status.ollama is True

    def test_services_unavailable(self):
        status = HealthStatus(
            status="ok",
            ollama=False,
            whisper=False,
            tts=False,
        )
        assert status.ollama is False
        assert status.ollama_model is None
