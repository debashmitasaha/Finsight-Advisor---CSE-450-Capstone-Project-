from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.router import get_current_user, hash_password
from app.database import get_db
from app.models import Company, Department, Transaction, UploadBatch, User, UserRole
from app.services.common import calculate_department_budget_usage, serialize_user

router = APIRouter(prefix="/admin", tags=["Admin"])
MAX_ANNUAL_BUDGET = 9_999_999_999_999.99


def count_transactions_for_department(db: Session, department_id: str) -> int:
    return int(
        db.query(func.count(Transaction.transaction_id))
        .filter(Transaction.department_id == department_id)
        .scalar()
        or 0
    )


def get_department_budget_snapshot(db: Session, department: Department) -> dict[str, float]:
    transactions = db.query(Transaction).filter(Transaction.department_id == department.department_id).all()
    return calculate_department_budget_usage(transactions, float(department.annual_budget or 0))


def serialize_department_summary(db: Session, department: Department) -> dict[str, object]:
    company = department.company
    return {
        "department_id": str(department.department_id),
        "department_name": department.department_name,
        "company_id": str(department.company_id) if department.company_id else None,
        "company_name": company.company_name if company else None,
        "annual_budget": float(department.annual_budget or 0),
        "transaction_count": count_transactions_for_department(db, department.department_id),
        **get_department_budget_snapshot(db, department),
    }


class CompanyCreate(BaseModel):
    company_name: str


class DepartmentCreate(BaseModel):
    department_name: str
    annual_budget: float = Field(default=0.0, ge=0, le=MAX_ANNUAL_BUDGET)
    company_id: Optional[str] = None


class DepartmentUpdate(BaseModel):
    annual_budget: float = Field(ge=0, le=MAX_ANNUAL_BUDGET)


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    company_id: Optional[str] = None
    is_admin: bool = False


class RoleUpdate(BaseModel):
    permissions: list[str]


class UserStatusUpdate(BaseModel):
    is_active: bool


@router.get("/overview")
def admin_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company_filter = current_user.company_id if current_user.company_id else None
    departments_query = db.query(Department)
    users_query = db.query(User)
    transactions_query = db.query(Transaction)
    uploads_query = db.query(UploadBatch)

    if company_filter:
        departments_query = departments_query.filter(Department.company_id == company_filter)
        users_query = users_query.filter(User.company_id == company_filter)
        department_ids = [dept.department_id for dept in departments_query.all()]
        transactions_query = transactions_query.filter(Transaction.department_id.in_(department_ids if department_ids else [""]))
        uploads_query = uploads_query.filter(UploadBatch.department_id.in_(department_ids if department_ids else [""]))
        departments = [
            serialize_department_summary(db, dept)
            for dept in db.query(Department).filter(Department.company_id == company_filter).all()
        ]
    else:
        departments = [
            serialize_department_summary(db, dept)
            for dept in departments_query.all()
        ]

    return {
        "companies": db.query(Company).count(),
        "departments": len(departments),
        "users": users_query.count(),
        "transactions": transactions_query.count(),
        "uploads": uploads_query.count(),
        "department_summaries": departments,
    }


@router.get("/companies")
def list_companies(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    companies = db.query(Company).all()
    return [
        {
            "company_id": str(company.company_id),
            "company_name": company.company_name,
            "department_count": db.query(Department).filter(Department.company_id == company.company_id).count(),
            "user_count": db.query(User).filter(User.company_id == company.company_id).count(),
            "is_active": True,
            "purchase_date": None,
        }
        for company in companies
    ]


@router.post("/companies")
def create_company(payload: CompanyCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin or current_user.company_id is not None:
        raise HTTPException(status_code=403, detail="Super admin access required")
    company = Company(company_name=payload.company_name)
    db.add(company)
    db.commit()
    db.refresh(company)
    return {"company_id": str(company.company_id), "company_name": company.company_name, "is_active": True, "purchase_date": None}


@router.get("/departments")
def list_departments(company_id: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Department)
    if company_id:
        query = query.filter(Department.company_id == company_id)
    elif current_user.company_id:
        query = query.filter(Department.company_id == current_user.company_id)
    departments = query.order_by(Department.department_name.asc()).all()
    return [
        {
            "department_id": str(dept.department_id),
            "department_name": dept.department_name,
            "annual_budget": float(dept.annual_budget or 0),
            "is_active": dept.is_active,
            "company_id": str(dept.company_id) if dept.company_id else None,
            "transaction_count": count_transactions_for_department(db, dept.department_id),
            **get_department_budget_snapshot(db, dept),
        }
        for dept in departments
    ]


@router.post("/departments")
def create_department(payload: DepartmentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    target_company_id = payload.company_id or current_user.company_id
    department = Department(
        department_name=payload.department_name,
        annual_budget=payload.annual_budget,
        company_id=target_company_id,
        is_active=True,
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return {
        "department_id": str(department.department_id),
        "department_name": department.department_name,
        "annual_budget": float(department.annual_budget or 0),
        "company_id": str(department.company_id) if department.company_id else None,
    }


@router.patch("/departments/{department_id}")
def update_department(department_id: str, payload: DepartmentUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    department = db.query(Department).filter(Department.department_id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    if current_user.company_id and str(department.company_id) != str(current_user.company_id):
        raise HTTPException(status_code=403, detail="You cannot modify another company's department")

    department.annual_budget = payload.annual_budget
    db.commit()
    db.refresh(department)

    return {
        "department_id": str(department.department_id),
        "department_name": department.department_name,
        "annual_budget": float(department.annual_budget or 0),
        "is_active": department.is_active,
        "company_id": str(department.company_id) if department.company_id else None,
        "transaction_count": count_transactions_for_department(db, department.department_id),
        **get_department_budget_snapshot(db, department),
    }


@router.get("/users")
def list_users(company_id: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(User)
    if company_id:
        query = query.filter(User.company_id == company_id)
    elif current_user.company_id:
        query = query.filter(User.company_id == current_user.company_id)
    return [serialize_user(user) for user in query.order_by(User.username.asc()).all()]


@router.post("/users")
def create_user(payload: UserCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        company_id=payload.company_id or current_user.company_id,
        is_admin=payload.is_admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return serialize_user(user)


@router.post("/users/{user_id}/assign-role")
def assign_role(user_id: str, dept_id: str, payload: RoleUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    role = db.query(UserRole).filter(UserRole.user_id == user_id, UserRole.dept_id == dept_id).first()
    if not payload.permissions:
        if role:
            db.delete(role)
            db.commit()
        return {"success": True, "user_id": user_id, "department_id": dept_id, "permissions": []}
    if role:
        role.permissions = payload.permissions
    else:
        role = UserRole(user_id=user_id, dept_id=dept_id, permissions=payload.permissions)
        db.add(role)
    db.commit()
    return {"success": True, "user_id": user_id, "department_id": dept_id, "permissions": payload.permissions}


@router.patch("/users/{user_id}/status")
def update_user_status(user_id: str, payload: UserStatusUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    target_user = db.query(User).filter(User.user_id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    target_user.is_active = payload.is_active
    db.commit()
    db.refresh(target_user)
    return serialize_user(target_user)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    if str(current_user.user_id) == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    target_user = db.query(User).filter(User.user_id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(target_user)
    db.commit()
    return {"success": True, "user_id": user_id}
