"""Who did what, and when.

The ``access_log`` table has been in the schema from the beginning, with indexes,
but nothing ever wrote a row to it, so the Audit Logs page had nothing to show and
fell back to repeating the transaction history.

Rather than edit every router to add a logging call, the request cycle is hooked
once. Any request that changes something, made by a signed-in user, is recorded.
Reads are ignored on purpose: an audit trail of every page view is noise that
buries the handful of events anyone actually looks for.

Nothing here may break a request. Every failure path swallows its exception and
gives up on the log entry instead.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.auth.router import ALGORITHM, SECRET_KEY, get_current_user
from app.database import SessionLocal, get_db
from app.models import AccessLog, Department, User

router = APIRouter(prefix="/admin", tags=["Audit"])

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# A request path on its own ("POST /forensic-engine/review") tells a reader almost
# nothing. These turn the ones that matter into a sentence.
ACTION_LABELS: list[tuple[str, str, str]] = [
    ("POST", r"^/auth/login$", "Signed in"),
    ("POST", r"^/auth/register$", "Registered an account"),
    ("POST", r"^/auth/refresh$", ""),  # housekeeping, not worth a row
    ("POST", r"^/transactions?/upload", "Uploaded a ledger"),
    ("DELETE", r"^/transactions?/", "Deleted transactions"),
    ("POST", r"^/grouping/", "Ran semantic grouping"),
    ("POST", r"^/categorization/expense/predict", "Asked for expense category suggestions"),
    ("POST", r"^/categorization/expense/approve", "Approved expense categories"),
    ("POST", r"^/categorization/", "Ran categorisation"),
    ("POST", r"^/budget/", "Ran a budget forecast"),
    ("POST", r"^/forensic/", "Ran the rule-based forensic scan"),
    ("POST", r"^/forensic-engine/analyze", "Ran the intelligence engine"),
    ("POST", r"^/forensic-engine/benchmark", "Ran the synthetic benchmark"),
    ("POST", r"^/forensic-engine/calibrate", "Ran a calibration"),
    ("POST", r"^/forensic-engine/review", "Recorded a review verdict"),
    ("DELETE", r"^/forensic-engine/review", "Withdrew a review verdict"),
    ("PUT", r"^/forensic-engine/calibration-settings", "Changed calibration settings"),
    ("POST", r"^/admin/companies", "Created a company"),
    ("POST", r"^/admin/departments", "Created a department"),
    ("PUT", r"^/admin/departments", "Updated a department"),
    ("POST", r"^/admin/users", "Created a user"),
    ("PUT", r"^/admin/users/[^/]+/scopes", "Changed an employee's access"),
    ("PUT", r"^/admin/users", "Updated a user"),
    ("DELETE", r"^/admin/users", "Deleted a user"),
]


def describe(method: str, path: str) -> str:
    """A sentence for the log, or '' for requests not worth recording."""
    for verb, pattern, label in ACTION_LABELS:
        if method == verb and re.search(pattern, path):
            return label
    # Anything new gets a readable fallback rather than being dropped silently.
    tail = path.strip("/").replace("-", " ").replace("/", " ")
    verb = {"POST": "Created", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted"}.get(method, method.title())
    return f"{verb}: {tail}" if tail else ""


def record(
    db: Session,
    user_id: str | None,
    action: str,
    dept_id: str | None = None,
    transaction_id: str | None = None,
) -> None:
    """Append one row. Never raises: a missing audit line must not fail the request."""
    if not action:
        return
    try:
        db.add(
            AccessLog(
                user_id=str(user_id) if user_id else None,
                dept_id=str(dept_id) if dept_id else None,
                transaction_id=str(transaction_id) if transaction_id else None,
                action=action,
            )
        )
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _user_id_from_request(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(header[7:].strip(), SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None
    return str(payload["sub"]) if payload.get("sub") else None


# Routes that write their own row, because they know which department the work
# belonged to and the middleware cannot: the department arrives in the request
# body, which the endpoint has already consumed by the time this runs.
SELF_RECORDING = [
    r"^/forensic-engine/(analyze|benchmark|calibrate|review|calibration-settings)",
]


class AuditMiddleware(BaseHTTPMiddleware):
    """Records successful write requests made by a signed-in user."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method not in WRITE_METHODS or response.status_code >= 400:
            return response
        if any(re.search(pattern, request.url.path) for pattern in SELF_RECORDING):
            return response

        action = describe(request.method, request.url.path)
        if not action:
            return response

        user_id = _user_id_from_request(request)
        if not user_id:
            return response

        # Departments are usually in the request body, which has already been
        # consumed by the endpoint. Whatever is reachable from the URL is taken;
        # the rest is left null rather than buffering every upload in memory.
        dept_id = (
            request.path_params.get("dept_id")
            or request.path_params.get("department_id")
            or request.query_params.get("dept_id")
        )

        db = SessionLocal()
        try:
            record(db, user_id, action, dept_id)
        finally:
            db.close()
        return response


@router.get("/audit-logs")
def audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    days: int = Query(default=30, ge=1, le=365),
    dept_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recent actions, newest first.

    A company administrator sees their own company's people. The platform operator,
    who belongs to no company, sees everyone.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only an administrator can read the audit trail")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = db.query(AccessLog, User, Department).outerjoin(User, AccessLog.user_id == User.user_id).outerjoin(
        Department, AccessLog.dept_id == Department.department_id
    )
    query = query.filter(AccessLog.access_timestamp >= since)

    if current_user.company_id:
        query = query.filter(User.company_id == current_user.company_id)
    if dept_id:
        query = query.filter(AccessLog.dept_id == str(dept_id))

    rows = query.order_by(AccessLog.access_timestamp.desc()).limit(limit).all()

    def as_utc(value: datetime | None) -> str | None:
        """SQLite hands back a naive datetime that is really UTC. Sent without a
        marker the browser reads it as local time and every row lands hours off."""
        if not value:
            return None
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()

    entries = [
        {
            "log_id": str(log.log_id),
            "action": log.action,
            "at": as_utc(log.access_timestamp),
            "actor_name": user.username if user else None,
            "actor_email": user.email if user else None,
            "actor_is_admin": bool(user.is_admin) if user else None,
            "department_name": department.department_name if department else None,
            "transaction_id": str(log.transaction_id) if log.transaction_id else None,
        }
        for log, user, department in rows
    ]

    by_action: dict[str, int] = {}
    actors: set[str] = set()
    for entry in entries:
        by_action[entry["action"]] = by_action.get(entry["action"], 0) + 1
        if entry["actor_email"]:
            actors.add(entry["actor_email"])

    return {
        "entries": entries,
        "window_days": days,
        "total": len(entries),
        "distinct_actors": len(actors),
        "by_action": dict(sorted(by_action.items(), key=lambda item: -item[1])),
    }
