# backend/app/grouping/grouping_sbert.py

import json
import os
import re
from io import BytesIO
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer

# -------------------------
# Storage: dept-wise group memory (JSON + embeddings)
# -------------------------
GROUP_STORE_DIR = os.path.join(os.path.dirname(__file__), "group_store")
os.makedirs(GROUP_STORE_DIR, exist_ok=True)

# cache SBERT model
_MODEL: Optional[SentenceTransformer] = None


def get_model(model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        _MODEL = SentenceTransformer(model_name)
    return _MODEL


def clean_text(text: str) -> str:
    """
    Clean chart_account_head text:
    - remove brackets
    - remove digits
    - normalize spaces
    """
    if not isinstance(text, str):
        return ""
    t = text.lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"\[.*?\]", " ", t)
    t = re.sub(r"\d+", " ", t)
    t = re.sub(r"[^a-z\s&/.-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _json_path(dept_id: int) -> str:
    return os.path.join(GROUP_STORE_DIR, f"groups_dept_{dept_id}.json")


def _npz_path(dept_id: int) -> str:
    return os.path.join(GROUP_STORE_DIR, f"groups_dept_{dept_id}.npz")


def load_store(dept_id: int) -> Tuple[Dict, np.ndarray]:
    """
    store:
      { "next_group_no": int, "groups": [{"group_no": int, "rep_text": str}, ...] }
    embeddings:
      np.ndarray shape (K, D) normalized
    """
    jpath = _json_path(dept_id)
    epath = _npz_path(dept_id)

    if os.path.exists(jpath):
        with open(jpath, "r", encoding="utf-8") as f:
            store = json.load(f)
    else:
        store = {"next_group_no": 1, "groups": []}

    if os.path.exists(epath):
        data = np.load(epath)
        embs = data["embeddings"].astype(np.float32)
    else:
        embs = np.zeros((0, 384), dtype=np.float32)

    return store, embs


def save_store(dept_id: int, store: Dict, embeddings: np.ndarray) -> None:
    jpath = _json_path(dept_id)
    epath = _npz_path(dept_id)

    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

    np.savez_compressed(epath, embeddings=embeddings.astype(np.float32))


def encode_texts(texts: List[str], model_name: str, batch_size: int = 64) -> np.ndarray:
    """
    SBERT embeddings (normalized) => cosine sim = dot product
    """
    model = get_model(model_name)
    emb = model.encode(
        texts,
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype(np.float32)
    return emb


def best_match(vec: np.ndarray, group_embs: np.ndarray) -> Tuple[Optional[int], float]:
    if group_embs.size == 0:
        return None, -1.0
    sims = group_embs @ vec
    idx = int(np.argmax(sims))
    return idx, float(sims[idx])


def group_dataframe_sbert(
    df: pd.DataFrame,
    dept_id: int,
    text_col: str = "chart_account_head",
    sim_threshold: float = 0.80,
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    batch_size: int = 64,
    persist: bool = True,
) -> Tuple[pd.DataFrame, Dict]:
    """
    Adds:
      - group_no
      - group_name
      - _clean_text (debug)

    Uses dept-wise group_store so multiple CSV uploads keep stable group numbers.
    """
    if text_col not in df.columns:
        raise ValueError(f"Column '{text_col}' not found. Found: {list(df.columns)}")

    store, group_embs = load_store(dept_id)
    groups = store["groups"]
    next_group_no = int(store.get("next_group_no", 1))

    if "group_no" not in df.columns:
        df["group_no"] = pd.NA
    if "group_name" not in df.columns:
        df["group_name"] = pd.NA

    df["_clean_text"] = df[text_col].fillna("").astype(str).map(clean_text)

    to_group_idx = [i for i in range(len(df)) if pd.isna(df.at[i, "group_no"])]
    if not to_group_idx:
        return df, {
            "dept_id": dept_id,
            "processed": 0,
            "assigned": 0,
            "new_groups": 0,
            "note": "No rows with group_no == NULL.",
        }

    texts = [df.at[i, "_clean_text"] for i in to_group_idx]
    txn_embs = encode_texts(texts, model_name=model_name, batch_size=batch_size)

    if group_embs.size == 0:
        group_embs = np.zeros((0, txn_embs.shape[1]), dtype=np.float32)

    assigned = 0
    created = 0

    for local_i, row_i in enumerate(to_group_idx):
        vec = txn_embs[local_i]
        best_i, score = best_match(vec, group_embs)

        if best_i is not None and score >= sim_threshold:
            gno = int(groups[best_i]["group_no"])
            df.at[row_i, "group_no"] = gno
            df.at[row_i, "group_name"] = f"group_{gno}"
            assigned += 1
            continue

        # create new group
        gno = next_group_no
        next_group_no += 1
        rep = df.at[row_i, "_clean_text"] or str(df.at[row_i, text_col])

        groups.append({"group_no": gno, "rep_text": rep})
        group_embs = np.vstack([group_embs, vec.reshape(1, -1)])

        df.at[row_i, "group_no"] = gno
        df.at[row_i, "group_name"] = f"group_{gno}"

        assigned += 1
        created += 1

    store["groups"] = groups
    store["next_group_no"] = next_group_no

    if persist:
        save_store(dept_id, store, group_embs)

    summary = {
        "dept_id": dept_id,
        "rows_total": int(len(df)),
        "rows_grouped_now": int(assigned),
        "new_groups_created": int(created),
        "sim_threshold": sim_threshold,
        "text_col": text_col,
        "model_name": model_name,
        "group_store_json": _json_path(dept_id),
        "group_store_npz": _npz_path(dept_id),
    }
    return df, summary


def read_uploaded_file_to_df(filename: str, content: bytes) -> pd.DataFrame:
    """
    Reads CSV/TXT/XLSX into pandas DataFrame
    """
    ext = os.path.splitext(filename.lower())[1]
    if ext in [".xlsx", ".xls"]:
        # requires openpyxl
        return pd.read_excel(BytesIO(content))
    # CSV/TXT: auto delimiter detect
    return pd.read_csv(BytesIO(content), sep=None, engine="python")


def reset_group_store(dept_id: int) -> None:
    for p in [_json_path(dept_id), _npz_path(dept_id)]:
        if os.path.exists(p):
            os.remove(p)