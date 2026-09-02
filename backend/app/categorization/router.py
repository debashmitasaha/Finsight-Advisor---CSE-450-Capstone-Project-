from __future__ import annotations

from collections import Counter
import json
import os
import re
import urllib.error
import urllib.request

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.grouping.grouping_sbert import encode_texts
from app.models import Department, ExpenseCategory, Group, Transaction, User
from app.services.common import clean_chart_account_head, serialize_id

router = APIRouter(prefix="/categorization", tags=["Categorization"])

INITIAL_EXPENSE_CATEGORIES = [
    ("Remuneration", "Salary, wages, payroll, bonuses, allowances, and staff compensation."),
    ("Transportation Cost", "Vehicle, freight, travel, logistics, and transport-related expenditure."),
    ("Fuel", "Diesel, octane, petrol, generator fuel, and other fuel purchases."),
    ("Maintenance", "Repair, servicing, replacement parts, and routine maintenance work."),
    ("Office Supplies", "Stationery, printing, office consumables, and administrative supplies."),
    ("Software", "Software subscriptions, licenses, hosting, and digital tools."),
    ("Rent", "Office, warehouse, factory, equipment, or other rental payments."),
    ("Utilities", "Electricity, water, gas, internet, phone, and similar utility bills."),
    ("Training", "Employee training, workshops, seminars, courses, and development programs."),
]


class CategorizeRequest(BaseModel):
    dept_id: str


class ExpenseCategorizeRequest(BaseModel):
    dept_id: str
    max_groups: int = 30


class ExpenseGroupApprovalRequest(BaseModel):
    dept_id: str
    group_no: float | None = None
    chart_acc_head_name: str | None = None
    category_name: str | None = None


class ExpenseGroupRejectionRequest(BaseModel):
    dept_id: str
    group_no: float | None = None
    chart_acc_head_name: str | None = None


def category_key(name: str | None) -> str:
    return " ".join(str(name or "").strip().lower().replace("&", "and").split())


def category_display_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(name or "").strip())
    if not cleaned:
        return "Uncategorized Expense"
    return cleaned[:80]


def get_department(db: Session, dept_id: str) -> Department:
    department = db.query(Department).filter(Department.department_id == dept_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    return department


def ensure_initial_expense_categories(db: Session) -> None:
    changed = False
    for name, description in INITIAL_EXPENSE_CATEGORIES:
        key = category_key(name)
        exists = (
            db.query(ExpenseCategory)
            .filter(
                ExpenseCategory.company_id.is_(None),
                ExpenseCategory.department_id.is_(None),
                ExpenseCategory.category_key == key,
            )
            .first()
        )
        if exists:
            continue
        db.add(
            ExpenseCategory(
                name=name,
                category_key=key,
                description=description,
                is_system=True,
                is_active=True,
            )
        )
        changed = True
    if changed:
        db.flush()


def scoped_categories(db: Session, department: Department) -> list[ExpenseCategory]:
    ensure_initial_expense_categories(db)
    filters = [
        ExpenseCategory.company_id.is_(None),
        ExpenseCategory.department_id == department.department_id,
    ]
    if department.company_id:
        filters.append(ExpenseCategory.company_id == department.company_id)
    return (
        db.query(ExpenseCategory)
        .filter(ExpenseCategory.is_active.is_(True), or_(*filters))
        .order_by(ExpenseCategory.is_system.desc(), ExpenseCategory.name.asc())
        .all()
    )


def find_category_by_name(db: Session, department: Department, name: str) -> ExpenseCategory | None:
    key = category_key(name)
    for category in scoped_categories(db, department):
        if category.category_key == key:
            return category
    return None


def serialize_expense_category(category: ExpenseCategory) -> dict:
    return {
        "category_id": serialize_id(category.category_id),
        "company_id": serialize_id(category.company_id),
        "department_id": serialize_id(category.department_id),
        "name": category.name,
        "category_key": category.category_key,
        "description": category.description,
        "is_system": category.is_system,
        "is_active": category.is_active,
    }


def transaction_samples(transactions: list[Transaction], limit: int = 3) -> list[dict]:
    samples: list[dict] = []
    seen = set()
    for txn in transactions:
        label = " | ".join(
            part
            for part in [
                txn.description,
                txn.chart_acc_head,
                txn.account_head_group,
                txn.voucher_type,
            ]
            if part
        )
        normalized = category_key(label)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        samples.append(
            {
                "description": txn.description,
                "chart_acc_head": txn.chart_acc_head,
                "account_head_group": txn.account_head_group,
                "voucher_type": txn.voucher_type,
                "amount": float(txn.amount or 0),
                "transaction_type": txn.transaction_type or "debit",
            }
        )
        if len(samples) >= limit:
            break
    return samples


def ensure_groups_from_transactions(db: Session, dept_id: str) -> list[Group]:
    transactions = (
        db.query(Transaction)
        .filter(Transaction.department_id == dept_id)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    existing_groups = db.query(Group).filter(Group.dept_id == dept_id).all()
    groups = {group.chart_acc_head_name: group for group in existing_groups}
    groups_by_number = {
        float(group.group_no): group
        for group in existing_groups
        if group.group_no is not None
    }
    next_group_no = int(max([float(group.group_no or 0) for group in groups.values()], default=0)) + 1

    for txn in transactions:
        cleaned = txn.cleaned_chart_acc_head or clean_chart_account_head(txn.chart_acc_head) or clean_chart_account_head(txn.group_name)
        if not cleaned:
            cleaned = "ungrouped"
        txn.cleaned_chart_acc_head = cleaned if cleaned != "ungrouped" else txn.cleaned_chart_acc_head

        # A semantic group may contain several account heads. Prefer its group
        # number so categorization does not create duplicate Group rows.
        group = groups_by_number.get(float(txn.group_no)) if txn.group_no is not None else groups.get(cleaned)
        if not group:
            group_number = float(txn.group_no) if txn.group_no is not None else float(next_group_no)
            if txn.group_no is None:
                next_group_no += 1
            group_key = cleaned
            if group_key in groups:
                group_key = f"description_group_{int(group_number)}"
            group = Group(
                dept_id=dept_id,
                chart_acc_head_name=group_key,
                group_no=group_number,
                group_name=txn.group_name or f"group_{int(group_number)}",
                representative_text=txn.description or txn.chart_acc_head or cleaned,
            )
            db.add(group)
            groups[group_key] = group
            groups_by_number[group_number] = group

        if txn.group_no is None:
            txn.group_no = group.group_no
        if not txn.group_name:
            txn.group_name = group.group_name
        if not txn.expense_category_id and group.expense_category_id:
            txn.expense_category_id = group.expense_category_id

    db.flush()
    return list(groups.values())


def transactions_for_group(db: Session, group: Group) -> list[Transaction]:
    query = db.query(Transaction).filter(Transaction.department_id == group.dept_id)
    if group.group_no is not None:
        query = query.filter(Transaction.group_no == group.group_no)
    else:
        query = query.filter(Transaction.cleaned_chart_acc_head == group.chart_acc_head_name)
    return query.order_by(Transaction.transaction_date.desc()).all()


def serialize_expense_group(db: Session, group: Group) -> dict:
    transactions = transactions_for_group(db, group)
    category = group.expense_category
    if not category and group.expense_category_id:
        category = db.query(ExpenseCategory).filter(ExpenseCategory.category_id == group.expense_category_id).first()
    return {
        "dept_id": serialize_id(group.dept_id),
        "group_no": float(group.group_no) if group.group_no is not None else None,
        "group_name": group.group_name,
        "chart_acc_head_name": group.chart_acc_head_name,
        "representative_text": group.representative_text,
        "transaction_count": len(transactions),
        "samples": transaction_samples(transactions),
        "expense_category_id": serialize_id(group.expense_category_id),
        "expense_category_name": category.name if category else None,
        "expense_category_status": group.expense_category_status or "unassigned",
        "suggested_category_name": group.suggested_category_name,
        "suggested_category_confidence": float(group.suggested_category_confidence) if group.suggested_category_confidence is not None else None,
        "suggested_category_is_new": bool(group.suggested_category_is_new),
        "suggested_category_reason": group.suggested_category_reason,
        "suggested_category_source": group.suggested_category_source,
    }


def build_gemini_prompt(groups: list[dict], categories: list[ExpenseCategory]) -> str:
    category_lines = "\n".join(
        f'- {category.name}: {category.description or "No description"}'
        for category in categories
    )
    return f"""
You classify finance transaction groups into expenditure categories.

Existing categories:
{category_lines}

Rules:
- Choose one existing category when it clearly fits.
- Do not use Other, Others, Miscellaneous, or a generic catch-all category.
- If none of the existing categories fit, propose one concise new category name.
- Return JSON only.

For each group, use the sample transactions to classify the whole group.
Groups:
{json.dumps(groups, ensure_ascii=True, indent=2)}

Return this exact JSON shape:
{{
  "assignments": [
    {{
      "group_id": "same group_id from input",
      "category_name": "existing or proposed category",
      "is_new_category": false,
      "confidence": 0.0,
      "reason": "short reason"
    }}
  ]
}}
""".strip()


def call_gemini_for_expense_categories(groups: list[dict], categories: list[ExpenseCategory]) -> list[dict]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured in backend .env")

    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    schema = {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "group_id": {"type": "string"},
                        "category_name": {"type": "string"},
                        "is_new_category": {"type": "boolean"},
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                    "required": ["group_id", "category_name", "is_new_category", "confidence", "reason"],
                },
            }
        },
        "required": ["assignments"],
    }
    payload = {
        "contents": [{"role": "user", "parts": [{"text": build_gemini_prompt(groups, categories)}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore") or str(exc)
        raise HTTPException(status_code=502, detail=f"Gemini categorization failed: {detail}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini categorization failed: {exc}") from exc

    try:
        text = response_payload["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        return parsed.get("assignments", [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an unreadable categorization response") from exc


def group_identifier(group: Group) -> str:
    if group.group_no is not None:
        return f"group_no:{float(group.group_no)}"
    return f"chart:{group.chart_acc_head_name}"


@router.post("/predict")
def categorize_transactions(payload: CategorizeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    department = get_department(db, payload.dept_id)

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


@router.get("/expense-categories")
def list_expense_categories(
    dept_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_initial_expense_categories(db)
    if dept_id:
        department = get_department(db, dept_id)
        categories = scoped_categories(db, department)
    else:
        categories = (
            db.query(ExpenseCategory)
            .filter(ExpenseCategory.is_active.is_(True), ExpenseCategory.company_id.is_(None), ExpenseCategory.department_id.is_(None))
            .order_by(ExpenseCategory.name.asc())
            .all()
        )
    db.commit()
    return [serialize_expense_category(category) for category in categories]


@router.get("/dept/{dept_id}/expense-groups")
def get_expense_category_groups(dept_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_department(db, dept_id)
    groups = ensure_groups_from_transactions(db, dept_id)
    db.commit()
    return [
        serialize_expense_group(db, group)
        for group in sorted(groups, key=lambda item: float(item.group_no or 0))
    ]


@router.post("/expense/predict")
def suggest_expense_categories(
    payload: ExpenseCategorizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = get_department(db, payload.dept_id)
    categories = scoped_categories(db, department)
    groups = ensure_groups_from_transactions(db, payload.dept_id)
    candidates = []
    gemini_groups = []

    for group in sorted(groups, key=lambda item: float(item.group_no or 0)):
        if group.expense_category_status == "approved" and group.expense_category_id:
            continue
        transactions = transactions_for_group(db, group)
        samples = transaction_samples(transactions)
        if not samples:
            continue
        group_id = group_identifier(group)
        candidates.append(group)
        gemini_groups.append(
            {
                "group_id": group_id,
                "group_name": group.group_name,
                "chart_acc_head_name": group.chart_acc_head_name,
                "transaction_count": len(transactions),
                "samples": samples,
            }
        )
        if len(gemini_groups) >= max(1, min(payload.max_groups, 60)):
            break

    if not gemini_groups:
        return {"success": True, "suggested_count": 0, "groups": [serialize_expense_group(db, group) for group in groups]}

    assignments = call_gemini_for_expense_categories(gemini_groups, categories)
    assignment_by_id = {str(item.get("group_id")): item for item in assignments}

    existing_keys = {category.category_key for category in categories}
    suggested_count = 0
    for group in candidates:
        assignment = assignment_by_id.get(group_identifier(group))
        if not assignment:
            continue
        name = category_display_name(str(assignment.get("category_name") or ""))
        key = category_key(name)
        is_new = key not in existing_keys
        group.suggested_category_name = name
        group.suggested_category_confidence = max(0.0, min(float(assignment.get("confidence") or 0), 1.0))
        group.suggested_category_is_new = bool(is_new)
        group.suggested_category_reason = str(assignment.get("reason") or "")[:500]
        group.suggested_category_source = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
        group.suggested_category_payload = assignment
        group.expense_category_status = "pending_review"
        suggested_count += 1

    db.commit()
    refreshed_groups = db.query(Group).filter(Group.dept_id == payload.dept_id).order_by(Group.group_no.asc()).all()
    return {
        "success": True,
        "suggested_count": suggested_count,
        "groups": [serialize_expense_group(db, group) for group in refreshed_groups],
    }


@router.post("/expense-groups/approve")
def approve_expense_category_group(
    payload: ExpenseGroupApprovalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = get_department(db, payload.dept_id)
    query = db.query(Group).filter(Group.dept_id == payload.dept_id)
    if payload.group_no is not None:
        query = query.filter(Group.group_no == payload.group_no)
    elif payload.chart_acc_head_name:
        query = query.filter(Group.chart_acc_head_name == payload.chart_acc_head_name)
    else:
        raise HTTPException(status_code=400, detail="group_no or chart_acc_head_name is required")

    group = query.first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    category_name = category_display_name(payload.category_name or group.suggested_category_name or "")
    if not category_name:
        raise HTTPException(status_code=400, detail="Category name is required")

    category = find_category_by_name(db, department, category_name)
    if not category:
        category = ExpenseCategory(
            company_id=department.company_id,
            department_id=None,
            name=category_name,
            category_key=category_key(category_name),
            description=f"AI-suggested category approved from {group.group_name or group.chart_acc_head_name}.",
            is_system=False,
            is_active=True,
            created_by=current_user.user_id,
        )
        db.add(category)
        db.flush()

    group.expense_category_id = category.category_id
    group.expense_category_status = "approved"
    group.suggested_category_name = category.name
    group.suggested_category_is_new = False

    transactions = transactions_for_group(db, group)
    for txn in transactions:
        txn.expense_category_id = category.category_id

    db.commit()
    db.refresh(group)
    return {"success": True, "category": serialize_expense_category(category), "group": serialize_expense_group(db, group)}


@router.post("/expense-groups/reject")
def reject_expense_category_group(
    payload: ExpenseGroupRejectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Group).filter(Group.dept_id == payload.dept_id)
    if payload.group_no is not None:
        query = query.filter(Group.group_no == payload.group_no)
    elif payload.chart_acc_head_name:
        query = query.filter(Group.chart_acc_head_name == payload.chart_acc_head_name)
    else:
        raise HTTPException(status_code=400, detail="group_no or chart_acc_head_name is required")

    group = query.first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    group.expense_category_status = "rejected"
    group.suggested_category_name = None
    group.suggested_category_confidence = None
    group.suggested_category_is_new = False
    group.suggested_category_reason = None
    group.suggested_category_payload = None
    db.commit()
    return {"success": True, "group": serialize_expense_group(db, group)}
