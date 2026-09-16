"""
Pydantic schemas for API request/response models.
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ConversationMessage(BaseModel):
    """A single message in the conversation history."""
    role: str = Field(..., description="Role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ErrorDetail(BaseModel):
    """Structured error detail."""
    code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable error message")


class VoiceChatResponse(BaseModel):
    """Response from /api/voice-chat endpoint."""
    success: bool
    transcript: Optional[str] = None
    response: Optional[str] = None
    audio_url: Optional[str] = None
    error: Optional[ErrorDetail] = None


class HealthStatus(BaseModel):
    """Response from /api/health endpoint."""
    status: str
    ollama: bool
    ollama_model_available: bool
    whisper: bool
    tts: bool
    ollama_model: Optional[str] = None
    whisper_model: Optional[str] = None
