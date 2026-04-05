from __future__ import annotations

from sqlalchemy.orm import Session

from app.auth.router import hash_password
from app.models import Company, Department, User, UserRole


def seed_demo_data(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    company = Company(company_name='Acme Corporation')
    db.add(company)
    db.flush()

    finance = Department(department_name='Finance', annual_budget=1200000, company_id=company.company_id, is_active=True)
    operations = Department(department_name='Operations', annual_budget=850000, company_id=company.company_id, is_active=True)
    db.add_all([finance, operations])
    db.flush()

    super_admin = User(
        username='superadmin',
        email='superadmin@finsight.com',
        password_hash=hash_password('password123'),
        company_id=None,
        is_admin=True,
        is_active=True,
    )
    admin = User(
        username='admin',
        email='admin@finsight.com',
        password_hash=hash_password('password123'),
        company_id=company.company_id,
        is_admin=True,
        is_active=True,
    )
    employee = User(
        username='employee',
        email='employee@finsight.com',
        password_hash=hash_password('password123'),
        company_id=company.company_id,
        is_admin=False,
        is_active=True,
    )
    db.add_all([super_admin, admin, employee])
    db.flush()

    db.add_all([
        UserRole(dept_id=finance.department_id, user_id=admin.user_id, permissions=['manage_department', 'run_analysis']),
        UserRole(dept_id=finance.department_id, user_id=employee.user_id, permissions=['view_transactions']),
        UserRole(dept_id=operations.department_id, user_id=employee.user_id, permissions=['view_transactions']),
    ])
    db.commit()
