"""
LLM service using Ollama's local API.
Supports multi-turn conversation with configurable model.
"""
import json
import time
from typing import AsyncGenerator, List, Optional

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
        self._model_available = False

    def check_availability(self) -> bool:
        """
        Check if Ollama is running, reachable, and the configured model is installed.
        Returns True if Ollama service is reachable.
        """
        settings = get_settings()
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
                if resp.status_code == 200:
                    self._available = True
                    tags_data = resp.json()
                    
                    models = [m.get("name") for m in tags_data.get("models", [])]
                    
                    # Ensure exact match or tag inference
                    expected_model = settings.ollama_model
                    if expected_model in models or f"{expected_model}:latest" in models or expected_model.replace(':latest', '') in models:
                        self._model_available = True
                        logger.info(f"[OK] Ollama connected at {settings.ollama_base_url} (model: {settings.ollama_model})")
                    else:
                        self._model_available = False
                        logger.warning(
                            f"[WARN] Configured AI model '{settings.ollama_model}' is not installed.\n"
                            f"Run: ollama pull {settings.ollama_model}\n"
                            f"Available models: {', '.join(models) if models else 'None'}"
                        )
                    return True
                else:
                    self._available = False
                    self._model_available = False
                    logger.warning(f"[WARN] Ollama returned status {resp.status_code} at {settings.ollama_base_url}")
                    return False
        except Exception as e:
            self._available = False
            self._model_available = False
            logger.warning(f"[WARN] Ollama unavailable at {settings.ollama_base_url}: {e}")
            return False

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def is_model_available(self) -> bool:
        return self._model_available

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
            "keep_alive": "30m",
            "options": {
                "num_predict": settings.ollama_num_predict,
                "temperature": 0.7,
            },
        }

        logger.info(
            f"[LLM] Started: model={settings.ollama_model}, "
            f"messages={len(ollama_messages)}"
        )
        start = time.time()

        # Safely join base URL and endpoint
        base_url = settings.ollama_base_url.rstrip("/")
        endpoint = settings.ollama_chat_endpoint.lstrip("/")
        url = f"{base_url}/{endpoint}"

        try:
            with httpx.Client(timeout=settings.ollama_timeout) as client:
                resp = client.post(url, json=payload)
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
                error_body = e.response.text
                logger.error(f"[LLM] 404 Error from Ollama at {url}: {error_body}")
                
                # Differentiate between model missing and endpoint missing
                if not self._model_available:
                    raise LLMError(
                        f"Configured AI model '{settings.ollama_model}' is not installed. "
                        f"Run: ollama pull {settings.ollama_model}"
                    )
                else:
                    raise LLMError(f"AI chat endpoint not found. Please check your configuration.")
            
            logger.error(f"[LLM] HTTP Error {e.response.status_code} from Ollama: {e.response.text}")
            raise LLMError("Could not generate an AI response due to a server error.")
        except Exception as e:
            raise LLMError(f"AI service error: {str(e)}")

        elapsed = time.time() - start

        try:
            response_text = data["message"]["content"].strip()
        except (KeyError, TypeError) as e:
            raise LLMError(f"Unexpected response format from Ollama: {e}")

        if not response_text:
            raise LLMError("AI returned an empty response")

        logger.info(f"[LLM] Completed: {elapsed:.2f}s")
        logger.info(
            f"[LLM] Duration: {elapsed:.2f}s | "
            f"Length: {len(response_text)} chars | "
            f"Tokens: {data.get('eval_count', 'unknown')} eval / {data.get('prompt_eval_count', 'unknown')} prompt"
        )
        logger.debug(f"Response: {response_text[:100]}{'...' if len(response_text) > 100 else ''}")

        return response_text

    async def chat_stream(
        self,
        messages: List[ConversationMessage],
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Send messages to Ollama and yield the assistant response tokens over an async HTTP stream.
        """
        settings = get_settings()
        prompt = system_prompt or settings.system_prompt

        ollama_messages = [{"role": "system", "content": prompt}]
        for msg in messages:
            ollama_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": settings.ollama_model,
            "messages": ollama_messages,
            "stream": True,
            "keep_alive": "30m",
            "options": {
                "num_predict": settings.ollama_num_predict,
                "temperature": 0.7,
            },
        }

        logger.info(f"[LLM] Stream Started: model={settings.ollama_model}")
        start = time.time()

        base_url = settings.ollama_base_url.rstrip("/")
        endpoint = settings.ollama_chat_endpoint.lstrip("/")
        url = f"{base_url}/{endpoint}"

        try:
            async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
                async with client.stream("POST", url, json=payload) as response:
                    response.raise_for_status()
                    
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if "message" in data and "content" in data["message"]:
                                yield data["message"]["content"]
                        except json.JSONDecodeError:
                            logger.warning(f"[LLM] Failed to parse stream line: {line}")
                            
        except Exception as e:
            logger.error(f"[LLM] Stream Error: {e}")
            raise LLMError(f"AI stream error: {str(e)}")

        elapsed = time.time() - start
        logger.info(f"[LLM] Stream Completed: {elapsed:.2f}s")



# Module-level singleton
_llm_service = LLMService()


def get_llm_service() -> LLMService:
    """Return the shared LLMService instance."""
    return _llm_service
