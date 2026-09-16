"""
Voice chat API endpoint.
"""
from fastapi import APIRouter, File, Form, UploadFile

from app.schemas import VoiceChatResponse
from app.services.voice_chat import get_voice_chat_service

router = APIRouter()


@router.post("/voice-chat", response_model=VoiceChatResponse)
async def voice_chat(
    audio: UploadFile = File(..., description="Audio file from the browser"),
    conversation: str = Form(default="[]", description="JSON conversation history"),
) -> VoiceChatResponse:
    """
    Process a voice input through the full pipeline:
    Audio → Whisper STT → Ollama LLM → Piper TTS → Response.
    """
    service = get_voice_chat_service()
    return await service.process(audio, conversation)
