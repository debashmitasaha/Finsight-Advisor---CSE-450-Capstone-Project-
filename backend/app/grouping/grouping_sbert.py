from __future__ import annotations

import hashlib
from typing import Iterable

import numpy as np

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # pragma: no cover - optional runtime fallback
    SentenceTransformer = None


_MODEL = None
DEFAULT_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
FALLBACK_DIMENSION = 128


def get_model(model_name: str = DEFAULT_MODEL_NAME):
    global _MODEL
    if SentenceTransformer is None:
        return None
    if _MODEL is None:
        _MODEL = SentenceTransformer(model_name)
    return _MODEL


def _fallback_embedding(text: str, dimensions: int = FALLBACK_DIMENSION) -> np.ndarray:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values = np.frombuffer((digest * ((dimensions // len(digest)) + 1))[:dimensions], dtype=np.uint8).astype(np.float32)
    values = (values - 127.5) / 127.5
    norm = np.linalg.norm(values)
    return values if norm == 0 else values / norm


def encode_texts(texts: Iterable[str], model_name: str = DEFAULT_MODEL_NAME, batch_size: int = 32) -> np.ndarray:
    texts = [text or "" for text in texts]
    model = get_model(model_name)
    if model is None:
        return np.vstack([_fallback_embedding(text) for text in texts]) if texts else np.zeros((0, FALLBACK_DIMENSION), dtype=np.float32)

    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype(np.float32)
    return embeddings


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))
