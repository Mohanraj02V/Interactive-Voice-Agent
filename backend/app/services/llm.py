"""
LLM service using Ollama's local API.
Supports multi-turn conversation with configurable model.
"""
import time
from typing import List, Optional

import httpx

from app.config import get_settings
from app.schemas import ConversationMessage
from app.utils.logging import get_logger

logger = get_logger(__name__)


class LLMError(Exception):
    """Raised when LLM interaction fails."""
    pass


class LLMUnavailableError(LLMError):
    """Raised specifically when Ollama is not reachable."""
    pass


class LLMService:
    """
    Wraps Ollama's chat API for multi-turn conversation.
    """

    def __init__(self):
        self._available = False
        self._checked = False

    def check_availability(self) -> bool:
        """
        Check if Ollama is running and reachable.
        Returns True if available.
        """
        settings = get_settings()
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(f"{settings.ollama_base_url}/api/tags")
                if resp.status_code == 200:
                    self._available = True
                    logger.info(f"[OK] Ollama connected at {settings.ollama_base_url} "
                                f"(model: {settings.ollama_model})")
                    return True
                else:
                    self._available = False
                    logger.warning(f"[WARN] Ollama returned status {resp.status_code}")
                    return False
        except Exception as e:
            self._available = False
            logger.warning(f"[WARN] Ollama unavailable at {settings.ollama_base_url}: {e}")
            return False

    @property
    def is_available(self) -> bool:
        return self._available

    def chat(
        self,
        messages: List[ConversationMessage],
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Send messages to Ollama and return the assistant response text.

        Args:
            messages: Conversation history including the latest user message.
            system_prompt: Optional system prompt override.

        Returns:
            Response text from the LLM.

        Raises:
            LLMUnavailableError: If Ollama is not reachable.
            LLMError: For other LLM-related errors.
        """
        settings = get_settings()
        prompt = system_prompt or settings.system_prompt

        # Build message list for Ollama
        ollama_messages = [{"role": "system", "content": prompt}]
        for msg in messages:
            ollama_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": settings.ollama_model,
            "messages": ollama_messages,
            "stream": False,
            "options": {
                "num_predict": settings.ollama_num_predict,
                "temperature": 0.7,
            },
        }

        logger.info(
            f"LLM request started: model={settings.ollama_model}, "
            f"messages={len(ollama_messages)}"
        )
        start = time.time()

        try:
            with httpx.Client(timeout=settings.ollama_timeout) as client:
                resp = client.post(
                    f"{settings.ollama_base_url}/api/chat",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

        except httpx.ConnectError:
            self._available = False
            raise LLMUnavailableError(
                "AI service is currently unavailable. "
                "Please make sure Ollama is running."
            )
        except httpx.TimeoutException:
            raise LLMError(
                "AI service timed out. The model may be loading. Please try again."
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise LLMError(
                    f"Model '{settings.ollama_model}' not found in Ollama. "
                    f"Run: ollama pull {settings.ollama_model}"
                )
            raise LLMError(f"AI service returned an error: {e.response.status_code}")
        except Exception as e:
            raise LLMError(f"AI service error: {str(e)}")

        elapsed = time.time() - start

        try:
            response_text = data["message"]["content"].strip()
        except (KeyError, TypeError) as e:
            raise LLMError(f"Unexpected response format from Ollama: {e}")

        if not response_text:
            raise LLMError("AI returned an empty response")

        logger.info(f"LLM request completed in {elapsed:.2f}s")
        logger.debug(f"Response: {response_text[:100]}{'...' if len(response_text) > 100 else ''}")

        return response_text


# Module-level singleton
_llm_service = LLMService()


def get_llm_service() -> LLMService:
    """Return the shared LLMService instance."""
    return _llm_service
