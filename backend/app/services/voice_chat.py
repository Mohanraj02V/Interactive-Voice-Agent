"""
Voice chat orchestration service.
Coordinates the full pipeline: Audio → STT → LLM → TTS → Response.
"""
import json
import time
from pathlib import Path
from typing import List, Optional, Tuple

from fastapi import UploadFile

from app.config import get_settings
from app.schemas import ConversationMessage, ErrorDetail, VoiceChatResponse
from app.services.llm import LLMError, LLMUnavailableError, get_llm_service
from app.services.speech_to_text import SpeechToTextError, get_stt_service
from app.services.text_to_speech import TTSError, TTSUnavailableError, get_tts_service
from app.utils.audio import AudioValidationError, save_upload
from app.utils.files import cleanup_file, cleanup_old_files, get_generated_audio_dir, get_temp_audio_dir
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Minimum transcript length to proceed to LLM
MIN_TRANSCRIPT_CHARS = 2


class VoiceChatService:
    """
    Orchestrates the full voice chat pipeline.
    """

    async def process(
        self,
        audio_file: UploadFile,
        conversation_json: str,
    ) -> VoiceChatResponse:
        """
        Process a voice chat request through the full pipeline.

        Args:
            audio_file: Uploaded audio file.
            conversation_json: JSON string with conversation history.

        Returns:
            VoiceChatResponse with transcript, response, and audio URL.
        """
        settings = get_settings()
        pipeline_start = time.time()
        saved_audio_path: Optional[Path] = None

        # Run old file cleanup in background (non-blocking, best-effort)
        self._run_cleanup()

        # Parse conversation history
        conversation = self._parse_conversation(conversation_json)

        logger.info(
            f"[REQUEST] Started: conversation_length={len(conversation)}"
        )
        
        # Timing trackers
        t_stt = 0.0
        t_llm = 0.0
        t_tts = 0.0

        try:
            # 1. Save uploaded audio
            try:
                saved_audio_path, extension = await save_upload(audio_file)
            except AudioValidationError as e:
                logger.warning(f"Audio validation failed: {e}")
                return VoiceChatResponse(
                    success=False,
                    error=ErrorDetail(
                        code="AUDIO_INVALID",
                        message=str(e),
                    ),
                )

            # 2. Speech to Text
            stt = get_stt_service()
            try:
                stt_start = time.time()
                transcript = stt.transcribe(saved_audio_path)
                t_stt = time.time() - stt_start
            except SpeechToTextError as e:
                return VoiceChatResponse(
                    success=False,
                    error=ErrorDetail(
                        code="TRANSCRIPTION_FAILED",
                        message=str(e),
                    ),
                )
            finally:
                # Always clean up the temp audio file
                cleanup_file(saved_audio_path)
                saved_audio_path = None

            # 3. Validate transcript
            if not transcript or len(transcript.strip()) < MIN_TRANSCRIPT_CHARS:
                logger.warning("Empty or too-short transcript")
                return VoiceChatResponse(
                    success=False,
                    error=ErrorDetail(
                        code="EMPTY_TRANSCRIPT",
                        message="I couldn't understand the audio. Please try speaking again.",
                    ),
                )

            # 4. Build messages for LLM
            messages = self._build_messages(conversation, transcript, settings.max_conversation_messages)

            # 5. LLM
            llm = get_llm_service()
            try:
                llm_start = time.time()
                llm_response = llm.chat(messages)
                t_llm = time.time() - llm_start
            except LLMUnavailableError as e:
                return VoiceChatResponse(
                    success=False,
                    transcript=transcript,
                    error=ErrorDetail(
                        code="LLM_UNAVAILABLE",
                        message=str(e),
                    ),
                )
            except LLMError as e:
                return VoiceChatResponse(
                    success=False,
                    transcript=transcript,
                    error=ErrorDetail(
                        code="LLM_ERROR",
                        message=str(e),
                    ),
                )

            # 6. TTS (non-fatal — return text even if TTS fails)
            tts = get_tts_service()
            audio_url: Optional[str] = None
            tts_warning: Optional[str] = None

            try:
                tts_start = time.time()
                audio_path = tts.synthesize(llm_response)
                t_tts = time.time() - tts_start
                audio_url = f"/api/audio/{audio_path.name}"
            except TTSUnavailableError as e:
                tts_warning = (
                    "AI response generated, but voice playback is currently unavailable. "
                    "Please install and configure Piper TTS."
                )
                logger.warning(f"TTS unavailable: {e}")
            except TTSError as e:
                tts_warning = "AI response generated, but voice synthesis encountered an error."
                logger.error(f"TTS error: {e}")

            elapsed = time.time() - pipeline_start
            overhead = elapsed - (t_stt + t_llm + t_tts)
            
            logger.info(
                f"\n--- [VOICE CHAT] Timing Waterfall ---\n"
                f"[STT]        {t_stt:.2f}s\n"
                f"[LLM]        {t_llm:.2f}s\n"
                f"[TTS]        {t_tts:.2f}s\n"
                f"[OVERHEAD]   {overhead:.2f}s\n"
                f"[REQUEST] Total: {elapsed:.2f}s\n"
                f"---------------------------------------"
            )

            return VoiceChatResponse(
                success=True,
                transcript=transcript,
                response=llm_response,
                audio_url=audio_url,
                error=ErrorDetail(code="TTS_UNAVAILABLE", message=tts_warning)
                if tts_warning else None,
            )

        except Exception as e:
            logger.exception(f"Unexpected error in voice chat pipeline: {e}")
            # Clean up on unexpected error
            if saved_audio_path:
                cleanup_file(saved_audio_path)
            return VoiceChatResponse(
                success=False,
                error=ErrorDetail(
                    code="INTERNAL_ERROR",
                    message="An unexpected error occurred. Please try again.",
                ),
            )

    def _parse_conversation(self, conversation_json: str) -> List[ConversationMessage]:
        """Parse conversation JSON string into a list of messages."""
        if not conversation_json or conversation_json.strip() in ("", "[]", "null"):
            return []
        try:
            data = json.loads(conversation_json)
            if not isinstance(data, list):
                return []
            messages = []
            for item in data:
                if isinstance(item, dict) and "role" in item and "content" in item:
                    messages.append(
                        ConversationMessage(role=item["role"], content=item["content"])
                    )
            return messages
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Could not parse conversation JSON: {e}")
            return []

    async def process_stream(
        self,
        audio_file: UploadFile,
        conversation_json: str,
    ):
        settings = get_settings()
        saved_audio_path: Optional[Path] = None
        
        t_utterance_received = time.time()
        t_stt_complete = 0.0
        t_first_llm_sentence_ready = 0.0
        t_first_audio_chunk_sent = 0.0

        self._run_cleanup()
        conversation = self._parse_conversation(conversation_json)
        
        try:
            # 1. Save uploaded audio
            try:
                saved_audio_path, extension = await save_upload(audio_file)
            except AudioValidationError as e:
                yield json.dumps({"type": "error", "code": "AUDIO_INVALID", "message": str(e)}) + "\n"
                return

            # 2. Speech to Text
            stt = get_stt_service()
            try:
                transcript = stt.transcribe(saved_audio_path)
                t_stt_complete = time.time()
            except SpeechToTextError as e:
                yield json.dumps({"type": "error", "code": "TRANSCRIPTION_FAILED", "message": str(e)}) + "\n"
                return
            finally:
                cleanup_file(saved_audio_path)
                saved_audio_path = None

            if not transcript or len(transcript.strip()) < MIN_TRANSCRIPT_CHARS:
                yield json.dumps({"type": "error", "code": "EMPTY_TRANSCRIPT", "message": "I couldn't understand the audio. Please try speaking again."}) + "\n"
                return

            yield json.dumps({"type": "transcript", "text": transcript}) + "\n"

            messages = self._build_messages(conversation, transcript, settings.max_conversation_messages)

            # 3. LLM Streaming
            llm = get_llm_service()
            tts = get_tts_service()
            
            buffer = ""
            full_response = ""
            
            async for token in llm.chat_stream(messages):
                buffer += token
                full_response += token
                
                if len(buffer.strip()) >= 10:
                    if buffer.rstrip().endswith((".", "?", "!", "\n")) or len(buffer) > 120:
                        sentence = buffer.strip()
                        buffer = ""
                        
                        if t_first_llm_sentence_ready == 0.0:
                            t_first_llm_sentence_ready = time.time()
                        
                        try:
                            audio_path = tts.synthesize(sentence)
                            audio_url = f"/api/audio/{audio_path.name}"
                            
                            if t_first_audio_chunk_sent == 0.0:
                                t_first_audio_chunk_sent = time.time()
                                logger.info(
                                    f"[LATENCY] stt={t_stt_complete - t_utterance_received:.2f}s "
                                    f"first_sentence={t_first_llm_sentence_ready - t_stt_complete:.2f}s "
                                    f"first_tts={t_first_audio_chunk_sent - t_first_llm_sentence_ready:.2f}s "
                                    f"total_to_first_audio={t_first_audio_chunk_sent - t_utterance_received:.2f}s"
                                )
                                
                            yield json.dumps({"type": "audio_chunk", "text": sentence, "audio_url": audio_url}) + "\n"
                        except TTSError as e:
                            logger.error(f"TTS error chunk: {e}")
                            yield json.dumps({"type": "error", "code": "TTS_ERROR", "message": "Voice synthesis error mid-stream."}) + "\n"
                            return
                            
            if buffer.strip():
                sentence = buffer.strip()
                try:
                    audio_path = tts.synthesize(sentence)
                    audio_url = f"/api/audio/{audio_path.name}"
                    yield json.dumps({"type": "audio_chunk", "text": sentence, "audio_url": audio_url}) + "\n"
                except TTSError as e:
                    logger.error(f"TTS error chunk: {e}")
                    yield json.dumps({"type": "error", "code": "TTS_ERROR", "message": "Voice synthesis error mid-stream."}) + "\n"
                    return

            yield json.dumps({
                "type": "done",
                "transcript": transcript,
                "full_response": full_response.strip()
            }) + "\n"

        except LLMUnavailableError as e:
            yield json.dumps({"type": "error", "code": "LLM_UNAVAILABLE", "message": str(e)}) + "\n"
        except LLMError as e:
            yield json.dumps({"type": "error", "code": "LLM_ERROR", "message": str(e)}) + "\n"
        except Exception as e:
            logger.exception(f"Unexpected error in stream: {e}")
            if saved_audio_path:
                cleanup_file(saved_audio_path)
            yield json.dumps({"type": "error", "code": "INTERNAL_ERROR", "message": "An unexpected error occurred."}) + "\n"

    def _build_messages(
        self,
        history: List[ConversationMessage],
        new_user_message: str,
        max_messages: int,
    ) -> List[ConversationMessage]:
        """
        Build the message list for the LLM.
        Limits history to max_messages and appends the new user message.
        """
        # Take the most recent messages up to the limit (minus 1 for the new message)
        recent_history = history[-(max_messages - 1):] if history else []
        messages = list(recent_history)
        messages.append(ConversationMessage(role="user", content=new_user_message))
        return messages

    def _run_cleanup(self) -> None:
        """Run best-effort cleanup of old audio files."""
        settings = get_settings()
        try:
            cleanup_old_files(get_temp_audio_dir(), settings.audio_retention_minutes)
            cleanup_old_files(get_generated_audio_dir(), settings.audio_retention_minutes)
        except Exception as e:
            logger.warning(f"Cleanup error (non-fatal): {e}")


# Module-level singleton
_voice_chat_service = VoiceChatService()


def get_voice_chat_service() -> VoiceChatService:
    """Return the shared VoiceChatService instance."""
    return _voice_chat_service
