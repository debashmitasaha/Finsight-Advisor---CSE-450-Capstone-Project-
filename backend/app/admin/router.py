from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth.router import get_current_user, hash_password
from app.database import get_db
from app.models import Company, Department, Transaction, UploadBatch, User, UserRole
from app.services.common import serialize_user

router = APIRouter(prefix="/admin", tags=["Admin"])


class CompanyCreate(BaseModel):
    company_name: str


class DepartmentCreate(BaseModel):
    department_name: str
    annual_budget: float = 0.0
    company_id: Optional[str] = None


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    company_id: Optional[str] = None
    is_admin: bool = False


class RoleUpdate(BaseModel):
    permissions: list[str]


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
            {
                "department_id": dept.department_id,
                "department_name": dept.department_name,
                "annual_budget": float(dept.annual_budget or 0),
                "transaction_count": db.query(Transaction).filter(Transaction.department_id == dept.department_id).count(),
            }
            for dept in db.query(Department).filter(Department.company_id == company_filter).all()
        ]
    else:
        departments = [
            {
                "department_id": dept.department_id,
                "department_name": dept.department_name,
                "annual_budget": float(dept.annual_budget or 0),
                "transaction_count": db.query(Transaction).filter(Transaction.department_id == dept.department_id).count(),
            }
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
            "company_id": company.company_id,
            "company_name": company.company_name,
            "department_count": db.query(Department).filter(Department.company_id == company.company_id).count(),
            "user_count": db.query(User).filter(User.company_id == company.company_id).count(),
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
    return {"company_id": company.company_id, "company_name": company.company_name}


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
            "department_id": dept.department_id,
            "department_name": dept.department_name,
            "annual_budget": float(dept.annual_budget or 0),
            "is_active": dept.is_active,
            "company_id": dept.company_id,
            "transaction_count": db.query(Transaction).filter(Transaction.department_id == dept.department_id).count(),
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
        "department_id": department.department_id,
        "department_name": department.department_name,
        "annual_budget": float(department.annual_budget or 0),
        "company_id": department.company_id,
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
    if role:
        role.permissions = payload.permissions
    else:
        role = UserRole(user_id=user_id, dept_id=dept_id, permissions=payload.permissions)
        db.add(role)
    db.commit()
    return {"success": True, "user_id": user_id, "department_id": dept_id, "permissions": payload.permissions}
