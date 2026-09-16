"""
Health check endpoint.
"""
from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthStatus
from app.services.llm import get_llm_service
from app.services.speech_to_text import get_stt_service
from app.services.text_to_speech import get_tts_service

router = APIRouter()


@router.get("/health", response_model=HealthStatus)
async def health_check() -> HealthStatus:
    """
    Check the availability of all AI services.
    Returns service status without crashing if a service is down.
    """
    settings = get_settings()
    stt = get_stt_service()
    llm = get_llm_service()
    tts = get_tts_service()

    # Re-check Ollama availability each time (it may start/stop)
    ollama_ok = llm.check_availability()

    return HealthStatus(
        status="ok",
        ollama=ollama_ok,
        whisper=stt.is_available,
        tts=tts.is_available,
        ollama_model=settings.ollama_model if ollama_ok else None,
        whisper_model=stt.model_size if stt.is_available else None,
    )
