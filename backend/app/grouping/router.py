from __future__ import annotations

from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.grouping.grouping_sbert import cosine_similarity, encode_texts
from app.models import Department, Group, Transaction, User
from app.services.common import clean_chart_account_head

router = APIRouter(prefix="/grouping", tags=["Grouping"])


class AssignGroupsRequest(BaseModel):
    dept_id: str
    similarity_threshold: float = 0.7


class AssignGroupsResponse(BaseModel):
    success: bool
    groups_assigned: int
    new_groups_created: int


def transaction_group_text(transaction: Transaction) -> str:
    """Use narration/description for semantic grouping; account heads remain metadata."""
    return (transaction.description or transaction.chart_acc_head or transaction.account_head_group or "").strip()


def group_key_for_new_group(dept_id: str, group_number: float) -> str:
    return f"description_group_{int(group_number)}"


@router.post("/assign-groups", response_model=AssignGroupsResponse)
def assign_transaction_groups(
    payload: AssignGroupsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = db.query(Department).filter(Department.department_id == payload.dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == payload.dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    if not transactions:
        return AssignGroupsResponse(success=True, groups_assigned=0, new_groups_created=0)

    existing_groups = db.query(Group).filter(Group.dept_id == payload.dept_id).order_by(Group.group_no.asc()).all()
    transaction_texts = [transaction_group_text(txn) for txn in transactions]
    transaction_embeddings = encode_texts(transaction_texts)

    # Rebuild each existing group's profile from its transaction descriptions. This
    # also upgrades old groups whose stored embedding was based on account heads.
    embeddings_by_group = {}
    for group in existing_groups:
        member_vectors = [
            transaction_embeddings[index]
            for index, txn in enumerate(transactions)
            if txn.group_no is not None and group.group_no is not None and float(txn.group_no) == float(group.group_no)
        ]
        if member_vectors:
            profile = np.mean(np.vstack(member_vectors), axis=0)
            profile_norm = np.linalg.norm(profile)
            embeddings_by_group[group] = profile / profile_norm if profile_norm else profile
        elif group.representative_text:
            embeddings_by_group[group] = encode_texts([group.representative_text])[0]
        else:
            embeddings_by_group[group] = np.zeros((0,), dtype=np.float32)

    next_group_no = int(max([float(group.group_no or 0) for group in existing_groups], default=0)) + 1
    groups_assigned = 0
    new_groups_created = 0

    for index, txn in enumerate(transactions):
        cleaned = clean_chart_account_head(txn.chart_acc_head)
        txn.cleaned_chart_acc_head = cleaned
        text = transaction_texts[index]
        if not text:
            continue

        vector = transaction_embeddings[index]
        best_match: Optional[Group] = None
        best_score = -1.0

        for group in existing_groups:
            profile = embeddings_by_group.get(group)
            if profile is None or profile.size == 0:
                continue
            score = cosine_similarity(vector, profile)
            if score > best_score:
                best_score = score
                best_match = group

        if best_match and best_score >= payload.similarity_threshold:
            txn.group_no = best_match.group_no
            txn.group_name = best_match.group_name or f"group_{int(float(best_match.group_no))}"
            groups_assigned += 1
            continue

        group_number = float(next_group_no)
        next_group_no += 1
        group_name = f"group_{int(group_number)}"
        new_group = Group(
            dept_id=payload.dept_id,
            chart_acc_head_name=group_key_for_new_group(payload.dept_id, group_number),
            group_no=group_number,
            group_name=group_name,
            representative_text=text,
            embedding=[float(x) for x in vector.tolist()],
        )
        db.add(new_group)
        db.flush()
        existing_groups.append(new_group)
        embeddings_by_group[new_group] = vector
        txn.group_no = group_number
        txn.group_name = group_name
        groups_assigned += 1
        new_groups_created += 1

    db.commit()
    return AssignGroupsResponse(success=True, groups_assigned=groups_assigned, new_groups_created=new_groups_created)


@router.get("/dept/{dept_id}/groups")
def get_department_groups(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    groups = db.query(Group).filter(Group.dept_id == dept_id).order_by(Group.group_no.asc()).all()
    return [
        {
            "dept_id": group.dept_id,
            "chart_acc_head_name": group.chart_acc_head_name,
            "group_no": float(group.group_no) if group.group_no is not None else None,
            "group_name": group.group_name,
            "representative_text": group.representative_text,
        }
        for group in groups
    ]


@router.get("/dept/{dept_id}/statistics")
def get_grouping_statistics(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total_groups = db.query(Group).filter(Group.dept_id == dept_id).count()
    grouped_transactions = db.query(Transaction).filter(Transaction.department_id == dept_id, Transaction.group_no.isnot(None)).count()
    ungrouped_transactions = db.query(Transaction).filter(Transaction.department_id == dept_id, Transaction.group_no.is_(None)).count()
    top_groups = (
        db.query(Transaction.group_name, func.count(Transaction.transaction_id).label("count"))
        .filter(Transaction.department_id == dept_id, Transaction.group_name.isnot(None))
        .group_by(Transaction.group_name)
        .order_by(func.count(Transaction.transaction_id).desc())
        .limit(10)
        .all()
    )
    return {
        "dept_id": dept_id,
        "total_groups": total_groups,
        "transactions_grouped": grouped_transactions,
        "transactions_ungrouped": ungrouped_transactions,
        "top_groups": [{"group_name": name, "count": count} for name, count in top_groups],
    }
