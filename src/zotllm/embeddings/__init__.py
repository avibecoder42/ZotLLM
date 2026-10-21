"""Austauschbare Embedding-Anbieter."""

from __future__ import annotations

from zotllm.embeddings.base import Embedder, EmbeddingError
from zotllm.settings import EmbeddingSettings


def make_embedder(cfg: EmbeddingSettings) -> Embedder:
    p = cfg.provider
    if p == "builtin":
        from zotllm.embeddings.builtin import BuiltinEmbedder

        return BuiltinEmbedder(cfg)
    if p == "ollama":
        from zotllm.embeddings.ollama import OllamaEmbedder

        return OllamaEmbedder(cfg)
    if p in ("openai", "openai_compatible"):
        from zotllm.embeddings.cloud import OpenAIEmbedder

        return OpenAIEmbedder(cfg, provider=p)
    if p == "gemini":
        from zotllm.embeddings.cloud import GeminiEmbedder

        return GeminiEmbedder(cfg)
    if p == "sentence_transformers":
        from zotllm.embeddings.local_st import SentenceTransformerEmbedder

        return SentenceTransformerEmbedder(cfg)
    raise EmbeddingError(f"Unbekannter Embedding-Anbieter: {p}")


__all__ = ["Embedder", "EmbeddingError", "make_embedder"]
