from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

__version__ = "0.1.0"

try:
    from ._native import Agent as _NativeAgent, get_version

    _NATIVE_AVAILABLE = True
except ImportError:
    _NATIVE_AVAILABLE = False
    _NativeAgent = None
    get_version = None


@dataclass(frozen=True)
class ModelConfig:
    max_tokens: int = 4096
    temperature: Optional[float] = None
    top_p: Optional[float] = None


@dataclass(frozen=True)
class Model:
    provider: str
    id: str
    config: ModelConfig = field(default_factory=ModelConfig)


def get_model(
    provider: str, model_id: str, config: Optional[ModelConfig] = None
) -> Model:
    return Model(provider=provider, id=model_id, config=config or ModelConfig())


def anthropic(model_id: str, config: Optional[ModelConfig] = None) -> Model:
    return get_model("anthropic", model_id, config)


def openai(model_id: str, config: Optional[ModelConfig] = None) -> Model:
    return get_model("openai", model_id, config)


class SpectraError(Exception):
    code: str
    detail: Optional[Any]

    def __init__(self, code: str, message: str, detail: Optional[Any] = None):
        super().__init__(message)
        self.code = code
        self.detail = detail


class Agent:
    def __init__(self, config: dict[str, Any]):
        self._config = config
        self._agent: Optional[Any] = None

        if _NATIVE_AVAILABLE and _NativeAgent is not None:
            import json

            self._agent = _NativeAgent(json.dumps(config))

    async def prompt(self, user_input: str) -> AsyncIterator[dict[str, Any]]:
        if self._agent is not None:
            import json

            result = self._agent.run(user_input)
            events = json.loads(result)
            for event in events:
                yield event
        else:
            yield {"type": "agent_start"}
            yield {
                "type": "error",
                "message": "Native binding not available - run 'maturin develop' to build",
            }
            yield {"type": "agent_end", "messages": []}


__all__ = [
    "Model",
    "ModelConfig",
    "get_model",
    "anthropic",
    "openai",
    "SpectraError",
    "Agent",
    "__version__",
]
