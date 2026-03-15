# backend/app/grouping/router.py

from fastapi import APIRouter, File, UploadFile, Query
from pydantic import BaseModel
from typing import List, Optional, Any, Dict

import pandas as pd
import os
from .grouping_sbert import group_dataframe_sbert, read_uploaded_file_to_df

router = APIRouter(prefix="/grouping", tags=["Grouping"])


# --------- Request models (same pattern as forensic/router.py) ----------
class GroupTxn(BaseModel):
    chart_account_head: str
    transaction_date: Optional[str] = None
    amount: Optional[float] = None


class GroupTxnList(BaseModel):
    dept_id: int
    transactions: List[GroupTxn]


# --------- Endpoint 1: JSON input (frontend already parsed file) ----------
@router.post("/sbert")
def group_from_json(
    data: GroupTxnList,
    sim_threshold: float = Query(0.80, ge=0.0, le=1.0),
    text_col: str = Query("chart_of_acc_head"),
    model_name: str = Query("sentence-transformers/all-MiniLM-L6-v2"),
):
    df = pd.DataFrame([t.dict() for t in data.transactions])
    df2, summary = group_dataframe_sbert(
        df=df,
        dept_id=data.dept_id,
        text_col=text_col,
        sim_threshold=sim_threshold,
        model_name=model_name,
        persist=True,
    )
    return {
        "summary": summary,
        "grouped_transactions": df2.to_dict(orient="records"),
    }


# --------- Endpoint 2: File upload (backend reads file using pandas) ----------
@router.post("/upload_sbert")
async def group_from_upload(
    dept_id: int = Query(..., description="Department id (used to keep group memory)"),
    file: UploadFile = File(...),
    text_col: str = Query("chart_of_acc_head"),
    sim_threshold: float = Query(0.80, ge=0.0, le=1.0),
    model_name: str = Query("sentence-transformers/all-MiniLM-L6-v2"),
):
    content = await file.read()
    df = read_uploaded_file_to_df(file.filename or "uploaded.csv", content)

    df2, summary = group_dataframe_sbert(
        df=df,
        dept_id=dept_id,
        text_col=text_col,
        sim_threshold=sim_threshold,
        model_name=model_name,
        persist=True,
    )

    OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    out_path = os.path.join(OUTPUT_DIR, f"grouped_dept_{dept_id}.csv")


    if os.path.exists(out_path):
        os.remove(out_path)

    df2.to_csv(out_path, index=False)
    
    # return only small preview to avoid huge response
    preview = df2.head(10).to_dict(orient="records")
    return {
        "summary": summary,
        "preview_first_10_rows": preview,
        "note": "Grouped with SBERT. Group memory saved per dept in backend/app/grouping/group_store/.",
        "output_csv": out_path    
    }


@router.post("/reset_store")
def reset_store(dept_id: int):
    from .grouping_sbert import reset_group_store
    reset_group_store(dept_id)
    return {"ok": True, "dept_id": dept_id, "message": "Group store reset done."}