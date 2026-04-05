from __future__ import annotations

from collections import Counter

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.grouping.grouping_sbert import encode_texts
from app.models import Department, Transaction, User

router = APIRouter(prefix="/categorization", tags=["Categorization"])


class CategorizeRequest(BaseModel):
    dept_id: str


@router.post("/predict")
def categorize_transactions(payload: CategorizeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    transactions = db.query(Transaction).filter(Transaction.department_id == payload.dept_id).all()
    if not transactions:
        return {"success": True, "categorized_count": 0, "necessary_count": 0, "unnecessary_count": 0, "uncategorized_count": 0}

    frequencies = Counter([txn.group_name or txn.cleaned_chart_acc_head or "ungrouped" for txn in transactions])
    texts = [f"{txn.description or ''} {txn.cleaned_chart_acc_head or txn.chart_acc_head or ''}".strip() for txn in transactions]
    embeddings = encode_texts(texts)

    necessary = 0
    unnecessary = 0
    uncategorized = 0
    categorized_count = 0

    for txn, embedding in zip(transactions, embeddings):
        group_key = txn.group_name or txn.cleaned_chart_acc_head or "ungrouped"
        freq = frequencies[group_key]
        amount = float(txn.amount)
        semantic_score = float(np.mean(np.abs(embedding))) if embedding.size else 0.0

        predicted = "necessary"
        if freq <= 2 and amount > 0:
            predicted = "unnecessary"
        if amount < 100 and freq > 2:
            predicted = "necessary"
        if not txn.description and not txn.chart_acc_head:
            predicted = "uncategorized"

        if freq <= 2 and predicted != "necessary":
            predicted = "unnecessary"

        txn.category = predicted
        txn.semantic_confidence = min(0.99, max(0.15, semantic_score))
        categorized_count += 1
        if predicted == "necessary":
            necessary += 1
        elif predicted == "unnecessary":
            unnecessary += 1
        else:
            uncategorized += 1

    db.commit()
    return {
        "success": True,
        "categorized_count": categorized_count,
        "necessary_count": necessary,
        "unnecessary_count": unnecessary,
        "uncategorized_count": uncategorized,
    }


@router.get("/dept/{dept_id}/summary")
def get_categorization_summary(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    transactions = db.query(Transaction).filter(Transaction.department_id == dept_id).all()
    counts = Counter([txn.category or "uncategorized" for txn in transactions])
    return {
        "dept_id": dept_id,
        "necessary": counts.get("necessary", 0),
        "unnecessary": counts.get("unnecessary", 0),
        "uncategorized": counts.get("uncategorized", 0),
        "total": len(transactions),
    }
