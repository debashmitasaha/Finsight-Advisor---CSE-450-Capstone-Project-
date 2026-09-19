# FastAPI, SQLAlchemy, and PostgreSQL in FinSight Advisor

This note explains how the database connection works in this project and how to build the same kind of database layer in a FastAPI application from scratch. It also shows how to create models, open and close sessions, run queries, handle transactions, build CRUD endpoints, use migrations, test database code, and avoid common security and performance problems.

The examples use placeholder credentials. Never copy a real password, hosted-database URL, or secret into documentation or source control.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [The database stack in this project](#2-the-database-stack-in-this-project)
3. [Relational database concepts you need](#3-relational-database-concepts-you-need)
4. [How FinSight establishes its database connection](#4-how-finsight-establishes-its-database-connection)
5. [Setting up PostgreSQL from scratch](#5-setting-up-postgresql-from-scratch)
6. [Configuring `DATABASE_URL` safely](#6-configuring-database_url-safely)
7. [Understanding the SQLAlchemy engine](#7-understanding-the-sqlalchemy-engine)
8. [Understanding `SessionLocal` and `Session`](#8-understanding-sessionlocal-and-session)
9. [Connecting a session to FastAPI with `get_db`](#9-connecting-a-session-to-fastapi-with-get_db)
10. [Defining ORM models](#10-defining-orm-models)
11. [Relationships, foreign keys, and cascades](#11-relationships-foreign-keys-and-cascades)
12. [Reading data](#12-reading-data)
13. [Creating data](#13-creating-data)
14. [Updating data](#14-updating-data)
15. [Deleting data](#15-deleting-data)
16. [Transactions, commit, flush, refresh, and rollback](#16-transactions-commit-flush-refresh-and-rollback)
17. [A complete CRUD feature](#17-a-complete-crud-feature)
18. [Joins, aggregates, pagination, and raw SQL](#18-joins-aggregates-pagination-and-raw-sql)
19. [Pydantic schemas versus SQLAlchemy models](#19-pydantic-schemas-versus-sqlalchemy-models)
20. [Authentication and authorization in database queries](#20-authentication-and-authorization-in-database-queries)
21. [Application startup and schema initialization](#21-application-startup-and-schema-initialization)
22. [Alembic migrations](#22-alembic-migrations)
23. [Connection pooling](#23-connection-pooling)
24. [Synchronous versus asynchronous database access](#24-synchronous-versus-asynchronous-database-access)
25. [Testing database-backed endpoints](#25-testing-database-backed-endpoints)
26. [Security checklist](#26-security-checklist)
27. [Performance checklist](#27-performance-checklist)
28. [Troubleshooting](#28-troubleshooting)
29. [Recommended improvements for this project](#29-recommended-improvements-for-this-project)
30. [Learning checklist and glossary](#30-learning-checklist-and-glossary)

---

## 1. The big picture

An HTTP API does not usually communicate with PostgreSQL directly. Several layers cooperate:

```text
React frontend or API client
            |
            | HTTP request
            v
      FastAPI endpoint
            |
            | Depends(get_db)
            v
   SQLAlchemy Session
            |
            | checks out a connection
            v
   SQLAlchemy Engine / Pool
            |
            | uses psycopg2
            v
       PostgreSQL server
```

In this project, each layer has a particular responsibility:

| Layer | Responsibility |
|---|---|
| FastAPI | Receives HTTP requests and calls endpoint functions |
| Pydantic | Validates request data and serializes response data |
| SQLAlchemy ORM | Maps Python classes and objects to tables and rows |
| SQLAlchemy `Session` | Runs queries and manages one unit of work/transaction |
| SQLAlchemy `Engine` | Knows how to reach the database and manages connections |
| `psycopg2` | Speaks the PostgreSQL wire protocol for synchronous SQLAlchemy |
| PostgreSQL | Stores data, enforces constraints, and executes SQL |

### One request from beginning to end

Consider this simplified request:

```http
GET /transactions/dept/finance-id
Authorization: Bearer <access-token>
```

The important steps are:

1. FastAPI matches the URL to an endpoint.
2. FastAPI sees `db: Session = Depends(get_db)`.
3. `get_db()` creates a SQLAlchemy session.
4. Authentication uses the session to load the current user.
5. The endpoint builds a transaction query.
6. The session obtains a physical connection from the engine's pool.
7. SQLAlchemy translates the Python query to SQL.
8. `psycopg2` sends the SQL and parameters to PostgreSQL.
9. PostgreSQL executes the query and returns rows.
10. SQLAlchemy converts the rows into `Transaction` objects.
11. FastAPI serializes the result into JSON.
12. The `finally` block in `get_db()` closes the session and returns its connection to the pool.

The important mental model is:

> The engine is application-wide, while a session is short-lived and normally belongs to one request.

Do not create a new engine for every request, and do not share one global session across requests.

---

## 2. The database stack in this project

The backend dependencies declare the following relevant packages:

```text
fastapi==0.135.1
sqlalchemy==2.0.25
psycopg2-binary==2.9.9
asyncpg==0.29.0
alembic==1.13.1
python-dotenv==1.0.1
pydantic==2.12.5
```

Their roles are:

- `fastapi`: API framework and dependency injection.
- `sqlalchemy`: ORM, query builder, transactions, engine, and connection pool.
- `psycopg2-binary`: synchronous PostgreSQL driver currently used by the project.
- `asyncpg`: asynchronous PostgreSQL driver that could support an async database layer, but the current database layer is synchronous.
- `alembic`: schema migration tool. It is installed, although the current startup path mainly uses `create_all()` and manual schema synchronization.
- `python-dotenv`: loads values from `backend/.env` into environment variables.
- `pydantic`: validates API request and response objects.

The principal files are:

```text
backend/
├── .env.example              # Example environment configuration
├── requirements.txt          # Python dependencies
└── app/
    ├── database.py           # URL, engine, sessions, initialization
    ├── models.py             # SQLAlchemy table mappings
    ├── main.py               # FastAPI startup and router registration
    ├── auth/router.py        # User lookup, registration, and login queries
    ├── admin/router.py       # Company, department, and user CRUD
    └── transaction/router.py # Transaction CRUD and upload operations
```

The application can work with two database types:

- PostgreSQL when `DATABASE_URL` is configured.
- A local SQLite file named `finsight_dev.db` when it is not configured.

SQLite is useful for simple local development, but production behavior should be tested against PostgreSQL because the dialects do not have identical types, constraints, concurrency, or SQL behavior.

---

## 3. Relational database concepts you need

### Table, row, and column

A SQLAlchemy model corresponds to a database table:

```python
class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True)
```

Conceptually:

```text
users table
+--------------------------------------+--------------------------+
| user_id                              | email                    |
+--------------------------------------+--------------------------+
| 238b73af-...                         | user@example.com         |
+--------------------------------------+--------------------------+
```

- The table is `users`.
- One saved user is a row.
- `user_id` and `email` are columns.

### Primary key

A primary key uniquely identifies a row:

```python
user_id = mapped_column(UUIDString(), primary_key=True)
```

### Foreign key

A foreign key connects one table to another:

```python
company_id = mapped_column(
    ForeignKey("company.company_id", ondelete="SET NULL"),
    nullable=True,
)
```

PostgreSQL prevents `company_id` from referring to a company that does not exist, unless it is `NULL`.

### Constraints

Constraints protect correctness even when application validation fails:

```python
email = mapped_column(Text, nullable=False, unique=True)
```

- `nullable=False`: the database rejects a missing value.
- `unique=True`: the database rejects duplicate values.

Application checks give friendly errors, but database constraints are the final protection against races and invalid data.

### Index

An index helps PostgreSQL find matching rows without scanning the entire table:

```python
Index("idx_transaction_department_id", Transaction.department_id)
```

Indexes improve reads but consume space and add work to inserts and updates. Index fields that are commonly used in filters, joins, sorting, or uniqueness checks.

### Transaction

A transaction groups database changes so they succeed or fail together:

```text
BEGIN
  create upload batch
  create 500 transaction rows
  mark upload batch complete
COMMIT
```

If row 400 is invalid, `ROLLBACK` can undo the entire unit rather than leaving a partially imported upload.

---

## 4. How FinSight establishes its database connection

The connection setup lives in `backend/app/database.py`.

### Step 1: Load the backend `.env` file

The project tries to import `load_dotenv` and then explicitly loads `backend/.env`:

```python
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
```

For `backend/app/database.py`:

```text
database.py parent      = backend/app
parents[1]              = backend
loaded file             = backend/.env
```

### Step 2: Read `DATABASE_URL`

```python
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./finsight_dev.db",
)
```

The second value is the fallback. Therefore:

```text
DATABASE_URL is present  -> use the configured URL
DATABASE_URL is absent   -> use sqlite:///./finsight_dev.db
```

### Step 3: Add SQLite-specific arguments

```python
connect_args = (
    {"check_same_thread": False}
    if DATABASE_URL.startswith("sqlite")
    else {}
)
```

SQLite normally restricts a connection to the thread that created it. FastAPI can execute synchronous dependencies and endpoints through worker threads, so this restriction is disabled for this development configuration.

PostgreSQL does not need this SQLite-specific option.

### Step 4: Create the engine

```python
engine = create_engine(
    DATABASE_URL,
    future=True,
    echo=os.getenv("SQL_ECHO", "False") == "True",
    connect_args=connect_args,
)
```

This creates the central SQLAlchemy engine. Engine creation usually configures the dialect and pool; an actual database connection is commonly opened lazily when the first query needs it.

### Step 5: Create the session factory

```python
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)
```

`SessionLocal` is a factory. Calling `SessionLocal()` produces one session.

### Step 6: Provide request-scoped sessions

```python
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Endpoints request it with FastAPI dependency injection:

```python
def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()
```

### Step 7: Initialize the schema during application startup

`backend/app/main.py` calls `init_db()` when FastAPI starts:

```python
@app.on_event("startup")
def on_startup() -> None:
    init_db()
```

The current `init_db()` sequence is:

```python
def init_db() -> None:
    prepare_sqlite_schema()
    Base.metadata.create_all(bind=engine)
    sync_postgres_schema()
    sync_sqlite_schema()
    seed_default_expense_categories()
```

This prepares legacy SQLite data, creates missing tables, manually adds some missing columns for each dialect, and inserts default expense categories.

---

## 5. Setting up PostgreSQL from scratch

This section demonstrates a local PostgreSQL setup. Hosted providers give you an equivalent connection URL instead.

### Install and start PostgreSQL

Installation commands depend on the operating system. Verify that the server and client are available:

```bash
psql --version
```

### Create a database user and database

Enter PostgreSQL as an administrative user, then run SQL similar to:

```sql
CREATE ROLE finsight_app
WITH LOGIN
PASSWORD 'replace-with-a-strong-password';

CREATE DATABASE finsight
OWNER finsight_app;
```

Connect to the new database:

```bash
psql -h localhost -U finsight_app -d finsight
```

Inside `psql`, useful commands include:

```text
\conninfo       show the current connection
\dt             list tables
\d users        describe the users table
\q              quit
```

### Install the Python dependencies

From the project directory:

```bash
python -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

The connection path is then:

```text
SQLAlchemy -> psycopg2 -> PostgreSQL
```

### Test PostgreSQL independently

Before blaming FastAPI, verify that the same host, port, username, and database work with `psql`:

```bash
psql "postgresql://finsight_app:YOUR_PASSWORD@localhost:5432/finsight"
```

Avoid putting a real password directly into shell history on shared systems. Prefer a `.pgpass` file, password prompt, or secret manager when appropriate.

---

## 6. Configuring `DATABASE_URL` safely

Create `backend/.env` locally:

```dotenv
DATABASE_URL=postgresql+psycopg2://finsight_app:YOUR_PASSWORD@localhost:5432/finsight
SQL_ECHO=False
```

The explicit driver form is:

```text
postgresql+psycopg2://username:password@host:port/database
```

The shorter form also resolves to a PostgreSQL driver supported by the environment:

```text
postgresql://username:password@host:port/database
```

### URL parts

```text
postgresql+psycopg2://finsight_app:password@localhost:5432/finsight
|          |          |            |        |    |    |
dialect    driver     username     password host port database
```

### Passwords containing special characters

Characters such as `@`, `/`, `:`, `#`, and `%` have special meaning in URLs. URL-encode them or construct the URL programmatically:

```python
from sqlalchemy import URL, create_engine

database_url = URL.create(
    drivername="postgresql+psycopg2",
    username="finsight_app",
    password="a-password-containing-@",
    host="localhost",
    port=5432,
    database="finsight",
)

engine = create_engine(database_url)
```

`URL.create()` accepts the password as plain text and handles rendering safely. Do not log the rendered URL with its password.

### `.env` rules

- Keep `backend/.env` outside version control.
- Commit a `backend/.env.example` containing placeholders only.
- Use different credentials for development, testing, and production.
- Rotate any credential that is accidentally committed or exposed.
- In production, prefer platform secrets or a secrets manager instead of a file.
- Never return `DATABASE_URL` from an API endpoint.

### Start the API

From `backend/` with the virtual environment active:

```bash
uvicorn app.main:app --reload
```

Then visit:

```text
http://localhost:8000/api/docs
```

### A database-aware health check

The existing `/health` endpoint only proves that FastAPI can answer. To test the database too, add a separate readiness endpoint:

```python
from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db


@app.get("/ready")
def readiness(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        ) from exc

    return {"status": "ready"}
```

Do not include credentials or detailed driver exceptions in the public response.

---

## 7. Understanding the SQLAlchemy engine

### What an engine is

The engine is an application-wide object that combines:

- Database dialect behavior
- DBAPI driver integration
- SQL compilation
- Connection pooling
- Transaction-capable connections

Creating an engine does not create tables. It also does not mean every request uses the same physical connection.

### Development configuration

The current project uses:

```python
engine = create_engine(
    DATABASE_URL,
    future=True,
    echo=os.getenv("SQL_ECHO", "False") == "True",
    connect_args=connect_args,
)
```

`future=True` selected SQLAlchemy's newer behavior in SQLAlchemy 1.4. SQLAlchemy 2.0 already uses that behavior, so it is harmless but largely redundant.

`echo=True` logs generated SQL. It is helpful when learning or debugging:

```dotenv
SQL_ECHO=True
```

Be cautious in production. SQL logs can be noisy and may reveal values or sensitive query patterns.

### A stronger production-style engine configuration

An example for a direct PostgreSQL connection is:

```python
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    echo=False,
)
```

- `pool_pre_ping=True`: checks a pooled connection before using it, reducing stale-connection failures.
- `pool_size=5`: keeps up to five regular pooled connections per application process.
- `max_overflow=10`: temporarily allows ten additional connections.
- `pool_timeout=30`: waits up to 30 seconds for a pool connection.
- `pool_recycle=1800`: replaces connections older than 30 minutes when checked out.

Do not copy pool numbers blindly. The total possible connections are approximately:

```text
application processes x (pool_size + max_overflow)
```

Four workers with `pool_size=5` and `max_overflow=10` could attempt up to 60 connections. That may exceed a hosted database plan's limit. When using a provider's transaction pooler, follow that provider's pooling guidance.

### Testing a connection at startup

```python
from sqlalchemy import text

with engine.connect() as connection:
    value = connection.execute(text("SELECT 1")).scalar_one()
    assert value == 1
```

`engine.connect()` checks out a connection. Leaving the `with` block closes the SQLAlchemy connection and returns the underlying DBAPI connection to the pool.

### `engine.begin()`

The project uses `engine.begin()` for schema statements:

```python
with engine.begin() as connection:
    connection.execute(text("ALTER TABLE ..."))
```

This begins a transaction, commits it if the block succeeds, and rolls it back if the block raises an exception.

---

## 8. Understanding `SessionLocal` and `Session`

### Factory versus instance

```python
SessionLocal = sessionmaker(bind=engine)
```

`SessionLocal` is the factory. This creates an instance:

```python
db = SessionLocal()
```

The type of `db` is `Session`.

### What a session does

A session:

- Tracks ORM objects loaded or created during a unit of work.
- Maintains an identity map so one database row maps to one in-session object.
- Begins and controls transactions.
- Flushes changes into SQL statements.
- Checks out connections when required.

It is not a safe global cache and must not be shared concurrently between requests.

### Current settings

```python
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)
```

#### `bind=engine`

Sessions made by the factory use this engine.

#### `autoflush=False`

SQLAlchemy does not automatically flush pending changes before every query. The code must rely on `commit()` or explicitly call `flush()` when it needs database-generated values or constraint checking before commit.

Example:

```python
department = Department(department_name="Finance")
db.add(department)
db.flush()

# The INSERT has been sent, but the transaction is not committed yet.
print(department.department_id)
```

#### `autocommit=False`

Operations participate in explicit transactions. Saving changes requires `db.commit()`.

#### `expire_on_commit=False`

By default, SQLAlchemy may mark object attributes as expired after commit so future access reloads them. This project keeps loaded values available after commit, which is convenient when immediately serializing an object into an API response.

You may still use `db.refresh(object)` to fetch database-generated or normalized values.

### Identity map example

Within one session:

```python
first = db.get(User, user_id)
second = db.get(User, user_id)

assert first is second
```

This does not mean the session is a general cross-request cache. A new request normally receives a new session and identity map.

---

## 9. Connecting a session to FastAPI with `get_db`

### Current implementation

```python
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

When an endpoint has:

```python
db: Session = Depends(get_db)
```

FastAPI runs the dependency up to `yield`, passes `db` into the endpoint, and returns to the dependency afterward so the `finally` block always runs.

### Why `close()` matters

Closing the session:

- Releases ORM/session resources.
- Rolls back any still-open uncommitted transaction.
- Returns checked-out connections to the engine's pool.

Without proper cleanup, requests can exhaust the connection pool.

### Recommended rollback-aware dependency

The current implementation always closes the session, which safely cleans up uncommitted work. An explicit rollback makes the error behavior and session state clearer:

```python
from collections.abc import Generator

from sqlalchemy.orm import Session


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

This dependency does not automatically commit successful requests. Endpoint/service code still chooses the transaction boundary with `db.commit()`.

### Why not automatically commit every request?

An automatic commit-after-yield dependency is possible, but explicit commits often make API code easier to reason about:

```python
def create_department(..., db: Session = Depends(get_db)):
    department = Department(...)
    db.add(department)
    db.commit()  # The write boundary is visible here.
```

Whichever convention is selected should be consistent across the project.

### Dependency reuse

FastAPI caches a dependency result within a request by default. If both `get_current_user()` and an endpoint depend on `get_db`, they generally receive the same request-scoped session:

```python
def get_current_user(db: Session = Depends(get_db)):
    ...


@router.get("/example")
def example(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ...
```

---

## 10. Defining ORM models

### Base class

All mapped models inherit from the project base:

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

`Base.metadata` collects information about every imported mapped table. That metadata is later used by `create_all()` and Alembic autogeneration.

### A small typed model

```python
from datetime import datetime
import uuid

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column


class Project(Base):
    __tablename__ = "project"

    project_id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
```

### Python default versus server default

```python
default=lambda: str(uuid.uuid4())
```

This default is produced by Python/SQLAlchemy when an ORM row is inserted.

```python
server_default=func.now()
```

This default is produced by PostgreSQL. It also works when another application inserts a row without SQLAlchemy.

### FinSight's cross-dialect UUID type

The project defines `UUIDString(TypeDecorator)` because it supports PostgreSQL and SQLite:

```text
PostgreSQL -> native UUID type and uuid.UUID driver values
SQLite     -> VARCHAR(36)
Python API -> normalized string result
```

Its three important hooks are:

- `load_dialect_impl()`: chooses a database type for the active dialect.
- `process_bind_param()`: converts Python values before sending them to the database.
- `process_result_value()`: converts returned database values into strings.

If the project only supported PostgreSQL, a model could use PostgreSQL's UUID type directly. The custom decorator provides portability.

### Financial numeric values

The project maps money-like fields with `Numeric`, for example:

```python
amount: Mapped[float] = mapped_column(
    Numeric(15, 2),
    nullable=False,
)
```

For strict accounting arithmetic, Python `Decimal` is safer than `float` because binary floating-point cannot exactly represent many decimal fractions:

```python
from decimal import Decimal

amount: Mapped[Decimal] = mapped_column(
    Numeric(15, 2),
    nullable=False,
)
```

The project currently annotates several numeric fields as `float` and frequently converts results to `float` for API responses. Understand the rounding trade-off before changing this behavior.

### Reserved SQL words

The project names the account table `users`, not `user`, and uses the table name `transaction`. Some words can be reserved or require quoting in certain databases. Prefer uncomplicated plural or domain-specific names when designing new tables.

---

## 11. Relationships, foreign keys, and cascades

### Foreign key versus relationship

These are related but different:

```python
company_id: Mapped[str | None] = mapped_column(
    ForeignKey("company.company_id"),
)

company: Mapped[Company | None] = relationship(
    "Company",
    back_populates="users",
)
```

- `company_id` is a real database column and foreign-key constraint.
- `company` is an ORM convenience that loads a `Company` object.

The reverse side is:

```python
users: Mapped[list[User]] = relationship(
    "User",
    back_populates="company",
)
```

Then Python code can navigate both directions:

```python
user.company
company.users
```

### One-to-many

One company has many departments:

```text
Company 1 -------- * Department
```

The foreign key belongs on the many side:

```python
Department.company_id -> Company.company_id
```

### Many-to-many with data on the association

Users and departments are connected through `UserRole`:

```text
User 1 ---- * UserRole * ---- 1 Department
```

This is an association object rather than a plain link table because it stores additional information:

```python
permissions: Mapped[list[str]] = mapped_column(JSON)
```

### Database `ondelete` behavior

Examples from the project include:

```python
ForeignKey("company.company_id", ondelete="SET NULL")
```

Deleting the company leaves the child row but sets its `company_id` to `NULL`.

```python
ForeignKey("users.user_id", ondelete="CASCADE")
```

Deleting the user instructs the database to delete matching association rows.

### ORM cascade behavior

```python
roles = relationship(
    "UserRole",
    back_populates="user",
    cascade="all, delete-orphan",
)
```

This is SQLAlchemy-side object lifecycle behavior. It is not identical to the database's `ON DELETE CASCADE`, although the two are often configured to cooperate.

### Lazy loading and the N+1 problem

This can issue one user query followed by one role query per user:

```python
users = db.query(User).all()

for user in users:
    print(user.roles)
```

Use eager loading when the response needs related data for many rows:

```python
from sqlalchemy import select
from sqlalchemy.orm import selectinload

statement = (
    select(User)
    .options(
        selectinload(User.roles)
        .selectinload(UserRole.department)
    )
    .order_by(User.username)
)

users = db.scalars(statement).all()
```

`selectinload()` normally loads relationships with additional batched `IN` queries. `joinedload()` loads using joins and can be useful for many-to-one relationships. Always inspect generated SQL and measure rather than assuming one strategy is universally best.

---

## 12. Reading data

The project currently uses `db.query(...)` heavily. SQLAlchemy 2.0 also supports and recommends `select(...)`. Both styles are shown here.

### Fetch all rows

Current project style:

```python
departments = db.query(Department).all()
```

SQLAlchemy 2.0 style:

```python
from sqlalchemy import select

statement = select(Department)
departments = db.scalars(statement).all()
```

### Fetch by primary key

The shortest ORM operation is:

```python
department = db.get(Department, department_id)
```

Return an HTTP 404 when it does not exist:

```python
department = db.get(Department, department_id)
if department is None:
    raise HTTPException(
        status_code=404,
        detail="Department not found",
    )
```

### Fetch one row using a unique field

Current style:

```python
user = (
    db.query(User)
    .filter(User.email == email)
    .first()
)
```

Modern style:

```python
statement = select(User).where(User.email == email)
user = db.scalar(statement)
```

### Multiple conditions

Arguments to `.where()` or `.filter()` are combined with `AND`:

```python
statement = select(UserRole).where(
    UserRole.user_id == user_id,
    UserRole.dept_id == department_id,
)

role = db.scalar(statement)
```

Explicit Boolean expressions are also possible:

```python
from sqlalchemy import and_, or_

statement = select(Transaction).where(
    and_(
        Transaction.department_id == department_id,
        or_(
            Transaction.is_flagged.is_(True),
            Transaction.risk_score >= 70,
        ),
    )
)
```

Use `.is_(None)`, `.is_not(None)`, `.is_(True)`, and `.is_(False)` for SQL null and Boolean comparisons:

```python
statement = select(User).where(User.company_id.is_(None))
```

### `first`, `one`, and `one_or_none`

- `.first()` returns the first result or `None` and can hide accidental duplicates.
- `.one()` requires exactly one result; zero or multiple rows raise exceptions.
- `.one_or_none()` permits zero or one but rejects multiple rows.

With modern results:

```python
result = db.execute(statement)
user = result.scalar_one_or_none()
```

Use database unique constraints when the business rule requires uniqueness.

### Sorting

```python
statement = (
    select(Transaction)
    .where(Transaction.department_id == department_id)
    .order_by(Transaction.transaction_date.desc())
)
```

### `IN`

```python
allowed_statuses = ["pending", "approved"]

statement = select(Transaction).where(
    Transaction.approval_status.in_(allowed_statuses)
)
```

### Date range filtering

Prefer a half-open range (`>= start`, `< end`) for timestamps:

```python
statement = select(Transaction).where(
    Transaction.transaction_date >= start,
    Transaction.transaction_date < end,
)
```

This handles every time within the final day without constructing `23:59:59.999999`.

### Dynamic filters

```python
statement = select(Transaction).where(
    Transaction.department_id == department_id
)

if category is not None:
    statement = statement.where(
        Transaction.category == category
    )

if flagged is not None:
    statement = statement.where(
        Transaction.is_flagged == flagged
    )

statement = statement.order_by(
    Transaction.transaction_date.desc()
)

transactions = db.scalars(statement).all()
```

SQLAlchemy builds a parameterized SQL statement; values are not concatenated into the SQL text.

---

## 13. Creating data

### Basic insert

```python
department = Department(
    department_name="Finance",
    annual_budget=1_000_000,
    company_id=company_id,
    is_active=True,
)

db.add(department)
db.commit()
db.refresh(department)
```

The object moves through broad states:

```text
transient -> pending -> persistent
 new         db.add      flush/commit
```

### Why `refresh()` is used

The database may provide:

- Server-generated timestamps
- Default values
- Trigger-modified fields
- Generated identifiers

`db.refresh(department)` reloads the row into the ORM object.

### Validate referenced rows

Before creating a department for a company:

```python
company = db.get(Company, payload.company_id)
if company is None:
    raise HTTPException(
        status_code=404,
        detail="Company not found",
    )
```

The foreign key would reject an invalid company anyway, but an explicit check produces a clearer API error.

### Insert multiple objects

```python
departments = [
    Department(
        department_name="Finance",
        company_id=company_id,
    ),
    Department(
        department_name="Operations",
        company_id=company_id,
    ),
]

db.add_all(departments)
db.commit()
```

For very large imports, learn SQLAlchemy bulk insert patterns and PostgreSQL `COPY`. Do not commit once per row because that creates unnecessary network and transaction overhead.

### Duplicate handling

An application pre-check alone is not sufficient:

```python
existing = db.scalar(
    select(User).where(User.email == payload.email)
)
```

Two concurrent requests can both see no existing row and then both attempt an insert. Keep the database unique constraint and handle `IntegrityError`:

```python
from sqlalchemy.exc import IntegrityError

try:
    db.add(user)
    db.commit()
except IntegrityError as exc:
    db.rollback()
    raise HTTPException(
        status_code=409,
        detail="Email or username already exists",
    ) from exc
```

---

## 14. Updating data

### ORM attribute update

This is the clearest pattern for ordinary API updates:

```python
transaction = db.get(Transaction, transaction_id)
if transaction is None:
    raise HTTPException(
        status_code=404,
        detail="Transaction not found",
    )

transaction.approval_status = "approved"
transaction.is_flagged = False

db.commit()
db.refresh(transaction)
```

SQLAlchemy tracks changed attributes and produces an `UPDATE` during flush.

### Partial updates

For a Pydantic PATCH schema:

```python
class TransactionPatch(BaseModel):
    approval_status: str | None = None
    is_flagged: bool | None = None
    flagged_reason: str | None = None
```

Only update fields explicitly supplied by the client:

```python
changes = payload.model_dump(exclude_unset=True)

for field_name, value in changes.items():
    setattr(transaction, field_name, value)

db.commit()
db.refresh(transaction)
```

Be careful with `exclude_none=True`: sometimes `null` intentionally means “clear this field.” `exclude_unset=True` distinguishes an omitted field from an explicitly supplied `null`.

### Set-based update

For updating many rows without loading each object:

```python
from sqlalchemy import update

statement = (
    update(Transaction)
    .where(
        Transaction.department_id == department_id,
        Transaction.approval_status == "pending",
    )
    .values(approval_status="review_required")
)

result = db.execute(statement)
db.commit()

updated_count = result.rowcount
```

Set-based operations are efficient, but they bypass some normal per-object Python behavior. Use them deliberately.

---

## 15. Deleting data

### ORM delete

```python
user = db.get(User, user_id)
if user is None:
    raise HTTPException(
        status_code=404,
        detail="User not found",
    )

db.delete(user)
db.commit()
```

Before deletion, understand all foreign keys and cascades connected to the record.

### Set-based delete

```python
from sqlalchemy import delete

statement = delete(Notification).where(
    Notification.created_at < cutoff
)

result = db.execute(statement)
db.commit()

deleted_count = result.rowcount
```

### Hard delete versus soft delete

The project has `is_active` for users and departments. Deactivating is a soft-delete-like operation:

```python
user.is_active = False
db.commit()
```

Advantages include auditability and the ability to restore access. A true delete removes the row and may cascade to related records. For financial systems, retention and audit requirements often make soft deletion preferable for business records.

---

## 16. Transactions, commit, flush, refresh, and rollback

These methods are commonly confused.

### `add()`

```python
db.add(object)
```

Registers a new or detached object with the session. It does not necessarily issue SQL immediately.

### `flush()`

```python
db.flush()
```

Sends pending `INSERT`, `UPDATE`, and `DELETE` statements to the database inside the current transaction. It does not make them permanent.

```text
flush -> PostgreSQL sees changes inside this transaction
commit -> changes become permanent and visible to other transactions
rollback -> flushed changes are undone
```

Use `flush()` when later work in the same transaction needs an inserted identifier or needs constraints checked:

```python
batch = UploadBatch(
    department_id=department_id,
    source_file_name=file_name,
)
db.add(batch)
db.flush()

# batch.upload_batch_id is now available for children.
for row in rows:
    db.add(
        Transaction(
            upload_batch_id=batch.upload_batch_id,
            department_id=department_id,
            amount=row.amount,
        )
    )

db.commit()
```

### `commit()`

```python
db.commit()
```

Flushes pending changes and commits the current database transaction.

### `refresh()`

```python
db.refresh(object)
```

Runs a query to reload that object's database values. It does not save changes.

### `rollback()`

```python
db.rollback()
```

Cancels the current transaction. After a database exception such as `IntegrityError`, rollback is required before the session can be used again.

### Robust transaction example

```python
from sqlalchemy.exc import IntegrityError, SQLAlchemyError


def create_company_service(db: Session, name: str) -> Company:
    company = Company(company_name=name)

    try:
        db.add(company)
        db.commit()
        db.refresh(company)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Company already exists",
        ) from exc
    except SQLAlchemyError:
        db.rollback()
        # Log the internal exception server-side.
        raise HTTPException(
            status_code=500,
            detail="Could not create company",
        )

    return company
```

Do not return raw database exceptions to API clients. They can reveal schema names, SQL, constraint names, or implementation details.

### Group related writes into one transaction

Bad transaction boundary:

```python
db.add(batch)
db.commit()

for transaction in transactions:
    db.add(transaction)
    db.commit()
```

If an insert fails, the database contains a partial batch.

Better boundary:

```python
try:
    db.add(batch)
    db.flush()

    db.add_all(transactions)
    batch.status = "complete"

    db.commit()
except Exception:
    db.rollback()
    raise
```

### Context-managed transaction

For service functions that own a fresh transaction:

```python
with SessionLocal() as db:
    with db.begin():
        db.add(Company(company_name="Example"))
        db.add(Department(department_name="Finance"))

# The inner block commits on success or rolls back on failure.
# The outer block closes the session.
```

Avoid starting a nested transaction without understanding whether the request session already has an active transaction.

---

## 17. A complete CRUD feature

This example shows how to add a simple `ProjectNote` feature using the project's synchronous architecture. It is intentionally separated into model, schema, and router concerns.

### Step 1: Define the model

Add an appropriate model to `backend/app/models.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship


class ProjectNote(Base):
    __tablename__ = "project_note"

    note_id: Mapped[str] = mapped_column(
        UUIDString(),
        primary_key=True,
        default=new_id,
    )
    department_id: Mapped[str] = mapped_column(
        ForeignKey(
            "department.department_id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
```

In a real change, also add matching relationships if navigation is useful and generate an Alembic migration.

### Step 2: Define Pydantic schemas

Create `backend/app/project_notes/schemas.py`:

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectNoteCreate(BaseModel):
    department_id: str
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=10_000)


class ProjectNotePatch(BaseModel):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
    )
    body: str | None = Field(
        default=None,
        min_length=1,
        max_length=10_000,
    )


class ProjectNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    note_id: str
    department_id: str
    title: str
    body: str
    created_by: str | None
    created_at: datetime
```

`from_attributes=True` allows Pydantic to read fields from ORM object attributes.

### Step 3: Build the router

Create `backend/app/project_notes/router.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.router import get_current_user
from app.database import get_db
from app.models import Department, ProjectNote, User
from app.project_notes.schemas import (
    ProjectNoteCreate,
    ProjectNotePatch,
    ProjectNoteResponse,
)


router = APIRouter(
    prefix="/project-notes",
    tags=["Project Notes"],
)


def require_department_access(
    db: Session,
    current_user: User,
    department_id: str,
) -> Department:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(
            status_code=404,
            detail="Department not found",
        )

    # This is a minimal company boundary check. An employee permission
    # check should also examine UserRole for this department.
    if (
        current_user.company_id is not None
        and str(department.company_id)
        != str(current_user.company_id)
    ):
        raise HTTPException(
            status_code=403,
            detail="Department access denied",
        )

    return department


@router.post(
    "",
    response_model=ProjectNoteResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_note(
    payload: ProjectNoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_department_access(
        db,
        current_user,
        payload.department_id,
    )

    note = ProjectNote(
        department_id=payload.department_id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        created_by=current_user.user_id,
    )

    try:
        db.add(note)
        db.commit()
        db.refresh(note)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not create note",
        )

    return note


@router.get("", response_model=list[ProjectNoteResponse])
def list_notes(
    department_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_department_access(
        db,
        current_user,
        department_id,
    )

    statement = (
        select(ProjectNote)
        .where(ProjectNote.department_id == department_id)
        .order_by(ProjectNote.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


@router.get(
    "/{note_id}",
    response_model=ProjectNoteResponse,
)
def get_note(
    note_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(ProjectNote, note_id)
    if note is None:
        raise HTTPException(
            status_code=404,
            detail="Note not found",
        )

    require_department_access(
        db,
        current_user,
        note.department_id,
    )

    return note


@router.patch(
    "/{note_id}",
    response_model=ProjectNoteResponse,
)
def update_note(
    note_id: str,
    payload: ProjectNotePatch,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(ProjectNote, note_id)
    if note is None:
        raise HTTPException(
            status_code=404,
            detail="Note not found",
        )

    require_department_access(
        db,
        current_user,
        note.department_id,
    )

    for field_name, value in payload.model_dump(
        exclude_unset=True
    ).items():
        setattr(note, field_name, value)

    try:
        db.commit()
        db.refresh(note)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not update note",
        )

    return note


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_note(
    note_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    note = db.get(ProjectNote, note_id)
    if note is None:
        raise HTTPException(
            status_code=404,
            detail="Note not found",
        )

    require_department_access(
        db,
        current_user,
        note.department_id,
    )

    try:
        db.delete(note)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not delete note",
        )
```

### Step 4: Register the router

In `backend/app/main.py`:

```python
from app.project_notes.router import router as project_notes_router

app.include_router(project_notes_router)
```

### Step 5: Add a migration

Do not rely on changing the Python model alone. Generate and inspect an Alembic migration as described later in this note.

### Step 6: Test through Swagger or `curl`

```bash
curl -X POST http://localhost:8000/project-notes \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "department_id": "DEPARTMENT_ID",
    "title": "Month-end review",
    "body": "Verify unusual transport expenses."
  }'
```

---

## 18. Joins, aggregates, pagination, and raw SQL

### Explicit join

Find transactions with their department names:

```python
statement = (
    select(
        Transaction.transaction_id,
        Transaction.amount,
        Department.department_name,
    )
    .join(
        Department,
        Transaction.department_id
        == Department.department_id,
    )
    .where(Department.company_id == company_id)
)

rows = db.execute(statement).all()

for transaction_id, amount, department_name in rows:
    print(transaction_id, amount, department_name)
```

### Aggregate query

```python
from sqlalchemy import func

statement = (
    select(
        Transaction.department_id,
        func.count(Transaction.transaction_id).label("count"),
        func.sum(Transaction.amount).label("total"),
    )
    .where(Transaction.transaction_type == "debit")
    .group_by(Transaction.department_id)
)

rows = db.execute(statement).all()
```

Rough SQL equivalent:

```sql
SELECT
    department_id,
    COUNT(transaction_id) AS count,
    SUM(amount) AS total
FROM transaction
WHERE transaction_type = 'debit'
GROUP BY department_id;
```

### Offset pagination

```python
page = 1
page_size = 25

statement = (
    select(Transaction)
    .order_by(
        Transaction.transaction_date.desc(),
        Transaction.transaction_id.desc(),
    )
    .offset((page - 1) * page_size)
    .limit(page_size)
)
```

Always use deterministic ordering. Offset pagination is simple but becomes slower and less stable across changing data at large offsets. Cursor/keyset pagination is better for very large tables.

### Count for paginated results

```python
count_statement = select(func.count()).select_from(
    Transaction
).where(Transaction.department_id == department_id)

total = db.scalar(count_statement) or 0
```

### Safe raw SQL

Use SQLAlchemy bind parameters:

```python
from sqlalchemy import text

statement = text(
    """
    SELECT transaction_id, amount
    FROM transaction
    WHERE department_id = :department_id
      AND amount >= :minimum_amount
    ORDER BY amount DESC
    """
)

rows = db.execute(
    statement,
    {
        "department_id": department_id,
        "minimum_amount": minimum_amount,
    },
).mappings().all()
```

Do not concatenate untrusted values:

```python
# Unsafe: vulnerable to SQL injection.
text(
    f"SELECT * FROM users WHERE email = '{email}'"
)
```

Bind parameters protect values. They cannot generally substitute table names or SQL keywords. If clients choose a sort field, map allowed names explicitly:

```python
allowed_sort_columns = {
    "date": Transaction.transaction_date,
    "amount": Transaction.amount,
    "risk": Transaction.risk_score,
}

sort_column = allowed_sort_columns.get(sort_by)
if sort_column is None:
    raise HTTPException(400, "Invalid sort field")

statement = select(Transaction).order_by(sort_column.desc())
```

---

## 19. Pydantic schemas versus SQLAlchemy models

These classes solve different problems:

| Pydantic schema | SQLAlchemy model |
|---|---|
| Defines API input/output | Defines database mapping |
| Validates JSON | Persists data |
| Controls public fields | Includes internal database fields |
| Short-lived data object | Session-managed ORM object |

### Input schema

```python
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8)
```

### ORM model

```python
class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
```

The API accepts `password`, hashes it, and stores `password_hash`. A response must never expose either the supplied password or stored hash.

### Response schema from an ORM object

```python
from pydantic import BaseModel, ConfigDict, EmailStr


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    username: str
    email: EmailStr
    is_active: bool
```

Then:

```python
@router.get("/{user_id}", response_model=UserResponse)
def get_user(...):
    return user
```

The response model also acts as a safety boundary by excluding `password_hash`.

---

## 20. Authentication and authorization in database queries

Authentication asks, “Who is making this request?” Authorization asks, “May this user access this row or perform this operation?”

### Authentication loads the user through the session

The project decodes the JWT subject and queries the database:

```python
def get_current_user(
    credentials=Depends(security),
    db: Session = Depends(get_db),
) -> User:
    user_id = decode_token(
        credentials.credentials,
        "access",
    )
    user = get_user_by_id(db, user_id)

    if not user or not user.is_active:
        raise HTTPException(status_code=401)

    return user
```

The database check means a deleted or inactive user is rejected even if their JWT has not expired.

### Authentication is not enough

This query limits rows by a client-provided department ID:

```python
select(Transaction).where(
    Transaction.department_id == department_id
)
```

It does not prove that the current user may access that department. A user can change the ID in the URL.

### Scope the query itself

For a company administrator:

```python
statement = (
    select(Transaction)
    .join(Department)
    .where(
        Transaction.department_id == department_id,
        Department.company_id == current_user.company_id,
    )
)
```

For an employee with a `UserRole` assignment:

```python
statement = (
    select(Transaction)
    .join(
        UserRole,
        UserRole.dept_id == Transaction.department_id,
    )
    .where(
        Transaction.department_id == department_id,
        UserRole.user_id == current_user.user_id,
    )
)
```

Scoping the data query can be safer than loading a row first and forgetting a separate ownership check.

### Reusable department permission dependency

```python
from fastapi import Depends, HTTPException
from sqlalchemy import select


def require_department_permission(permission: str):
    def check_permission(
        dept_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        department = db.get(Department, dept_id)
        if department is None:
            raise HTTPException(404, "Department not found")

        if current_user.is_admin:
            if (
                current_user.company_id is not None
                and str(department.company_id)
                != str(current_user.company_id)
            ):
                raise HTTPException(403, "Access denied")

            return current_user

        role = db.scalar(
            select(UserRole).where(
                UserRole.user_id == current_user.user_id,
                UserRole.dept_id == dept_id,
            )
        )

        if role is None or permission not in role.permissions:
            raise HTTPException(403, "Insufficient permission")

        return current_user

    return check_permission
```

Use it in an endpoint where the parameter is named `dept_id`:

```python
@router.get("/dept/{dept_id}")
def list_transactions(
    dept_id: str,
    current_user: User = Depends(
        require_department_permission("transactions:read")
    ),
    db: Session = Depends(get_db),
):
    ...
```

The frontend dashboard is not an authorization boundary. Every sensitive database operation must enforce authorization in the backend.

---

## 21. Application startup and schema initialization

### Current FinSight startup

`main.py` registers a startup handler:

```python
@app.on_event("startup")
def on_startup() -> None:
    init_db()
    if os.getenv("AUTO_SEED_DEMO", "True") == "True":
        db = SessionLocal()
        try:
            seed_demo_data(db)
        finally:
            db.close()
```

This performs database work before serving normal requests.

### `Base.metadata.create_all()`

```python
Base.metadata.create_all(bind=engine)
```

It creates mapped tables that do not exist. It is convenient for prototypes and tests.

It does not provide a complete production migration system. For example, changing:

```python
name = mapped_column(Text)
```

to:

```python
display_name = mapped_column(Text)
```

does not tell `create_all()` whether to rename `name`, create `display_name`, migrate data, or drop `name`.

### Manual schema synchronization in this project

The current `sync_postgres_schema()` executes multiple statements resembling:

```sql
ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS company_id UUID;
```

`sync_sqlite_schema()` inspects SQLite with `PRAGMA table_info` and adds selected missing columns.

This helps the current prototype tolerate older schemas, but it has limitations:

- Migration history is not recorded.
- Downgrades are not defined.
- Complex type changes and data migrations are difficult.
- Every application instance may try to run schema changes during startup.
- Reviewing exactly which schema version is deployed is harder.

### Seeding defaults

`seed_default_expense_categories()` checks for each system category before inserting it. This makes the seeding operation mostly idempotent: running it repeatedly should not create the same logical category repeatedly.

For reliable idempotency under concurrency, also keep appropriate database uniqueness constraints and handle integrity errors.

### Modern FastAPI lifespan style

FastAPI lifespan handlers are the modern alternative to `@app.on_event("startup")`:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    # Optional application shutdown work goes here.


app = FastAPI(lifespan=lifespan)
```

Database migrations are often better run as a deployment step before application instances start, rather than by every web worker.

---

## 22. Alembic migrations

Alembic records ordered schema changes. A migration is reviewed code that changes the database from one known version to another.

### Why migrations matter

Suppose a new model field is added:

```python
risk_level: Mapped[str | None] = mapped_column(Text)
```

The Python model changes immediately, but an existing production table still lacks the column. A migration bridges that difference:

```python
def upgrade() -> None:
    op.add_column(
        "transaction",
        sa.Column("risk_level", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transaction", "risk_level")
```

### Initialize Alembic

From `backend/`:

```bash
alembic init alembic
```

This normally creates:

```text
backend/
├── alembic.ini
└── alembic/
    ├── env.py
    ├── script.py.mako
    └── versions/
```

Do this only once for a project.

### Connect Alembic to the models

In `alembic/env.py`, import the project's base:

```python
from app.models import Base

target_metadata = Base.metadata
```

Load the URL from the environment rather than committing a password into `alembic.ini`:

```python
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

database_url = os.environ["DATABASE_URL"]
config.set_main_option(
    "sqlalchemy.url",
    database_url.replace("%", "%%"),
)
```

The percent replacement is relevant because Alembic's configuration parser treats `%` specially.

### Generate a migration

After changing a model:

```bash
alembic revision --autogenerate -m "add project notes"
```

Autogeneration is an assistant, not an authority. Open the generated migration and verify:

- Table and column names
- Nullability
- Foreign keys
- Indexes and unique constraints
- Server defaults
- Data preservation
- Upgrade and downgrade behavior

Alembic cannot always infer renames. It may generate “drop old column, add new column,” which would destroy data unless corrected.

### Apply and inspect migrations

```bash
alembic current
alembic history
alembic upgrade head
```

To downgrade one revision during development:

```bash
alembic downgrade -1
```

Downgrading production databases can be destructive. Prefer well-planned forward migrations and backups.

### Recommended deployment sequence

```text
1. Back up or verify recovery capability
2. Deploy migration-capable artifact
3. Run alembic upgrade head once
4. Start/restart API instances
5. Run readiness and smoke tests
```

Once Alembic is fully adopted, gradually remove the need for ad hoc schema-altering startup functions. Do not remove them until the existing databases have a known migration baseline.

---

## 23. Connection pooling

### Why a pool exists

Opening a PostgreSQL connection requires network and authentication work. SQLAlchemy reuses connections:

```text
request A -> session A -> connection 1
request B -> session B -> connection 2

request A finishes -> connection 1 returns to pool
request C arrives  -> session C reuses connection 1
```

### Session close versus physical close

`db.close()` ends the session's ownership of its connection. With a normal pool, the physical connection is generally returned for reuse rather than always terminated at PostgreSQL.

### Pool exhaustion

Common symptoms include timeouts and errors saying the pool limit has been reached. Typical causes are:

- Sessions are not closed.
- Requests hold transactions open for a long time.
- Slow queries occupy all connections.
- Pool size multiplied by worker count exceeds database capacity.
- External network calls occur while a database transaction remains open.

### Keep transactions short

Avoid this shape:

```text
begin database work
call slow AI service
wait 30 seconds
continue database work
commit
```

Where correctness allows, load the required data, end the transaction, perform external computation, and open a short transaction to save the result. If atomicity requires holding state, design that workflow explicitly with statuses or a job queue.

### Hosted poolers

A hosted PostgreSQL service may provide direct and pooled endpoints. Understand whether the pooler operates in session or transaction mode. Features that depend on persistent session state, temporary tables, or some prepared-statement behavior may differ under transaction pooling.

---

## 24. Synchronous versus asynchronous database access

### Current project: synchronous database layer

The project uses:

```text
create_engine
Session
psycopg2
```

Most database-heavy endpoints use regular `def`. FastAPI can run synchronous endpoint functions in a thread pool, preventing their blocking database calls from directly blocking the event loop.

### A mixed endpoint in the project

The transaction upload endpoint is `async def` because it awaits file reading, but it then uses a synchronous session:

```python
@router.post("/upload")
async def upload_transactions(
    file: UploadFile,
    db: Session = Depends(get_db),
):
    contents = await file.read()
    department = db.query(Department).filter(...).first()
```

Synchronous database and heavy dataframe/ML work inside `async def` can block the event loop. This may be acceptable in a low-traffic prototype but should be measured and redesigned for production load.

### Option A: stay synchronous

This is often the simplest choice. Use regular `def` endpoints for synchronous database and CPU-heavy workflows, and move long computations to background workers if necessary.

### Option B: make the entire database path asynchronous

Use an async URL and engine:

```dotenv
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/database
```

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


async_engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False,
)


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as db:
        try:
            yield db
        except Exception:
            await db.rollback()
            raise
```

Queries must also be awaited:

```python
from sqlalchemy import select


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.scalars(
        select(User).order_by(User.username)
    )
    return result.all()
```

Writes become:

```python
db.add(user)
await db.commit()
await db.refresh(user)
```

Do not pass a synchronous `Session` into async query code or await synchronous methods. A migration to async should be consistent across engine, driver, session, dependency, services, and routes.

Async database access improves concurrency for I/O-bound workloads; it does not make a slow SQL query faster and does not help CPU-heavy pandas or ML computation by itself.

---

## 25. Testing database-backed endpoints

Tests must not accidentally read, modify, or initialize the production database.

### Best approach: a separate PostgreSQL test database

Use a test-only URL such as:

```dotenv
TEST_DATABASE_URL=postgresql+psycopg2://test_user:test_password@localhost:5432/finsight_test
```

Run migrations against the test database before the suite.

### Override `get_db`

FastAPI allows dependency overrides:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import get_db
from app.main import app


test_engine = create_engine(TEST_DATABASE_URL)
TestingSessionLocal = sessionmaker(
    bind=test_engine,
    autoflush=False,
    expire_on_commit=False,
)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
```

Be careful: importing `app` and entering `TestClient` can run application lifespan/startup code. Ensure test environment variables are configured before importing modules that construct the engine, or refactor startup so tests cannot initialize the normal database.

### Simple endpoint test

```python
from fastapi.testclient import TestClient


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Authenticated endpoint tests also need a test user and a valid test JWT or an override for `get_current_user`.

### SQLite in-memory tests

For fast unit tests that do not depend on PostgreSQL-specific behavior:

```python
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool


test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

Base.metadata.create_all(test_engine)
```

`StaticPool` makes all test sessions reuse the same in-memory SQLite database. Without it, separate connections may see separate empty in-memory databases.

SQLite tests do not prove that PostgreSQL UUID, JSONB, timezone, locking, constraint, or SQL behavior is correct. Keep PostgreSQL integration tests for database-specific functionality.

### Transaction-isolated tests

A common advanced pattern starts a transaction for each test and rolls it back afterward. This makes tests fast and isolated. Application code that calls `commit()` requires careful nested-transaction/savepoint configuration, so implement this pattern only after understanding SQLAlchemy transaction boundaries.

### What to test

- Successful create, read, update, and delete
- Missing record returns 404
- Duplicate unique value returns 409 or the chosen error
- Invalid foreign key is rejected
- Rollback leaves no partial rows
- Inactive user is rejected
- Cross-company and cross-department access is denied
- Pagination and filters return correct rows
- Migrations work on a clean and an existing database

---

## 26. Security checklist

### Credentials

- Never commit `.env` or a real database URL.
- Commit only sanitized `.env.example` files.
- Rotate exposed passwords immediately.
- Give the application a dedicated PostgreSQL role.
- Do not run the web application as a PostgreSQL superuser.
- Use separate users and databases for development, tests, and production.
- Require TLS for remote production connections.

### SQL injection

Prefer ORM expressions:

```python
select(User).where(User.email == email)
```

Or bind raw SQL values:

```python
text("SELECT * FROM users WHERE email = :email")
```

Never insert untrusted data with f-strings or string concatenation.

### Authorization

- Do not trust company or department IDs supplied by the client.
- Scope every sensitive query to the authenticated user.
- Enforce admin and permission checks on the server.
- Remember that hiding a frontend button provides no API security.
- Test horizontal access: one employee trying another employee's department ID.
- Test vertical access: an employee trying an admin endpoint.

### Sensitive data

- Never return `password_hash`.
- Avoid logging credentials, tokens, or entire uploaded financial records.
- Return generic database errors to clients and log detailed errors securely.
- Apply retention, backup, and audit policies appropriate to financial data.

### Availability

- Put bounds on pagination and upload sizes.
- Configure query/statement timeouts where appropriate.
- Keep transactions short.
- Size pools according to database capacity and worker count.
- Monitor slow queries and connection usage.

---

## 27. Performance checklist

### Avoid loading more rows than needed

Bad:

```python
all_transactions = db.query(Transaction).all()
filtered = [
    row for row in all_transactions
    if row.department_id == department_id
]
```

Better:

```python
statement = select(Transaction).where(
    Transaction.department_id == department_id
)
transactions = db.scalars(statement).all()
```

Let PostgreSQL filter, join, sort, and aggregate.

### Paginate lists

Never let a normal list endpoint return millions of rows. Validate an upper bound:

```python
limit: int = Query(default=50, ge=1, le=100)
```

### Select only needed columns

For summaries:

```python
statement = select(
    Transaction.transaction_id,
    Transaction.amount,
    Transaction.risk_score,
)
```

This avoids transferring large text/JSON fields that the response does not need.

### Add indexes based on actual access patterns

Useful candidates commonly include:

- Foreign-key columns used in joins
- Department/company scoping fields
- Frequently filtered timestamps and statuses
- Unique business identifiers
- Columns used by deduplication

Use PostgreSQL's query plan tools:

```sql
EXPLAIN ANALYZE
SELECT *
FROM transaction
WHERE department_id = '...'
ORDER BY transaction_date DESC
LIMIT 50;
```

`EXPLAIN ANALYZE` actually executes the query. Use caution with writes and expensive production queries.

### Avoid N+1 relationship queries

Use `selectinload()` or `joinedload()` when serializing related objects in a list.

### Avoid committing in loops

Add rows and commit once per logical batch where correctness and memory allow.

### Do not hold sessions unnecessarily

A request-scoped session is appropriate for normal endpoints. Background jobs should create and close their own session rather than reusing a request's session after the response ends.

---

## 28. Troubleshooting

### `connection refused`

Likely causes:

- PostgreSQL is not running.
- Host or port is incorrect.
- Firewall/network access is blocked.
- Hosted database only permits certain networks.

Checks:

```bash
psql -h HOST -p 5432 -U USER -d DATABASE
```

### `password authentication failed`

Check the username, password, selected database, provider credentials, and special-character URL encoding. Do not print the password while debugging.

### `database does not exist`

The final path component of the URL is wrong, or the database has not been created.

### `No module named psycopg2`

Activate the correct virtual environment and install backend dependencies:

```bash
source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

### `relation does not exist`

The table is missing, the migration has not run, the application is connected to the wrong database/schema, or the model was not imported before metadata/migration generation.

Check:

```bash
alembic current
alembic upgrade head
```

### `column does not exist`

The Python model and database schema are on different versions. Generate/apply the correct migration; do not repeatedly patch production manually without recording the change.

### `PendingRollbackError`

A previous flush or commit failed, and the session was reused without rollback:

```python
try:
    db.commit()
except Exception:
    db.rollback()
    raise
```

### `DetachedInstanceError`

An ORM object is trying to lazy-load a relationship after its session has closed. Load required relationships before closing the session, use eager loading, or serialize the result while the request session is active.

### QueuePool timeout / too many connections

Check that every session is closed, transactions are short, worker and pool counts are reasonable, and queries are not hanging. Inspect the database's connection activity and slow queries.

### SQLite works but PostgreSQL fails

Possible differences include:

- UUID types
- JSON versus JSONB
- Boolean and date behavior
- Case sensitivity
- Reserved identifiers
- Constraint enforcement
- Concurrent writes
- Database-specific functions

Use PostgreSQL integration tests before deployment.

### No SQL appears while debugging

Set this locally:

```dotenv
SQL_ECHO=True
```

Restart the backend. Never assume SQL logging is safe for production.

### The health endpoint passes while the database is down

The current `/health` endpoint does not query PostgreSQL. Use a database-aware readiness check with `SELECT 1`.

---

## 29. Recommended improvements for this project

These are improvements to consider, not changes already made by this document.

### 1. Adopt Alembic as the schema source of truth

Create a baseline for existing databases, migrate manual startup alterations into versioned revisions, and run migrations as a deployment step.

### 2. Add explicit rollback handling

Update `get_db()` or use a shared service convention so failed transactions are always rolled back clearly.

### 3. Standardize SQLAlchemy 2.0 queries

Gradually prefer:

```python
select(Model).where(...)
db.scalar(...)
db.scalars(...)
```

over new uses of legacy `db.query(...)`. Existing working queries do not need a risky all-at-once rewrite.

### 4. Strengthen database authorization

Create reusable company and department access dependencies. Several routes currently authenticate the caller but do not consistently enforce stored `UserRole.permissions` for the requested department.

### 5. Improve engine production settings

Consider `pool_pre_ping`, provider-appropriate pool sizing, connection timeouts, TLS requirements, and monitoring.

### 6. Separate readiness from liveness

Keep a simple liveness endpoint and add a readiness endpoint that verifies `SELECT 1`.

### 7. Revisit sync/async boundaries

Do not perform long synchronous database, pandas, or ML work directly on the event loop. Either keep these workflows synchronous, use background workers, or consistently adopt async database access where it provides measured value.

### 8. Use `Decimal` deliberately for money

Review where exact decimal arithmetic is required. Keep PostgreSQL `NUMERIC`, and avoid unnecessary conversion to binary floats in accounting-critical calculations.

### 9. Make test database isolation explicit

Prevent startup and dependency code from connecting to a development or production database during tests. Add PostgreSQL integration tests for migrations and dialect-specific behavior.

### 10. Make bulk uploads atomic

Treat upload batch creation, transaction insertion, status updates, and failure handling as deliberate transaction boundaries so partial failures remain traceable and consistent.

---

## 30. Learning checklist and glossary

### Suggested learning order

Work through the topics in this order:

1. Basic SQL: tables, keys, constraints, joins, and transactions.
2. PostgreSQL: users, databases, connection URLs, and `psql`.
3. SQLAlchemy engine and connection pool.
4. `SessionLocal`, session lifecycle, and transactions.
5. FastAPI `Depends(get_db)`.
6. ORM models, foreign keys, and relationships.
7. CRUD with `select`, `add`, `commit`, `refresh`, and `delete`.
8. Pydantic request and response schemas.
9. Authentication and row-level authorization.
10. Alembic migrations.
11. Testing and dependency overrides.
12. Query performance and production operations.

### Practical exercises

After reading this note, try these in a development/test database:

1. Enable `SQL_ECHO` and observe SQL generated by `/auth/login`.
2. Use `psql` to inspect the `users`, `department`, and `transaction` tables.
3. Rewrite one read-only `db.query()` call with `select()`.
4. Add pagination to a list endpoint.
5. Intentionally violate a unique constraint and handle `IntegrityError` with rollback.
6. Create a related company and department in one transaction using `flush()`.
7. Demonstrate that rollback removes both rows when the second insert fails.
8. Use `selectinload()` and compare SQL output with lazy relationship access.
9. Add a permission test proving one employee cannot access another department.
10. Create an Alembic migration for a harmless nullable field in a test database.
11. Override `get_db` in a test and prove production data is untouched.
12. Run `EXPLAIN ANALYZE` for a department transaction query and identify its index use.

### Final mental model

```text
DATABASE_URL
    |
    v
create_engine()          one application-wide engine per process
    |
    v
sessionmaker()           configured session factory
    |
    v
get_db()                 one short-lived session per request
    |
    v
endpoint/service         validates access and runs ORM operations
    |
    v
flush/commit/rollback    controls the transaction
    |
    v
db.close()               releases request resources/connection
```

### Glossary

**ACID**: Atomicity, Consistency, Isolation, and Durability—the core properties of reliable transactions.

**Alembic**: SQLAlchemy's standard schema migration tool.

**Connection**: A communication channel to the database, normally checked out from the engine pool.

**Connection pool**: A reusable collection of database connections maintained by the engine.

**Constraint**: A database rule such as primary key, foreign key, unique, or not-null.

**DBAPI driver**: The Python library that speaks to a database, such as `psycopg2` for PostgreSQL.

**Dependency injection**: FastAPI's mechanism for providing objects such as sessions and authenticated users to endpoints.

**Dialect**: SQLAlchemy's knowledge of a particular database's SQL and data types, such as PostgreSQL or SQLite.

**Engine**: SQLAlchemy's application-wide interface to a database and its connection pool.

**Flush**: Send pending session changes to the database inside the current transaction without committing them.

**Foreign key**: A constraint connecting a column to a key in another table.

**Identity map**: The session mechanism that keeps one in-memory ORM identity for a loaded row.

**Index**: A database structure that accelerates selected lookups and ordering at a storage/write cost.

**Migration**: A versioned, repeatable schema change.

**N+1 query problem**: One initial query followed by a separate relationship query for every returned row.

**ORM**: Object-Relational Mapping—the conversion between Python classes/objects and database tables/rows.

**Pydantic model**: A validation and serialization schema used at the API boundary.

**Rollback**: Cancel all uncommitted changes in the current transaction.

**Session**: SQLAlchemy's unit-of-work and transaction-management object.

**Transaction**: A group of database operations that commits or rolls back as a unit.

**Unit of work**: A set of loaded and changed objects tracked together by a session.

---

## Quick reference

### Open and close a standalone session

```python
with SessionLocal() as db:
    users = db.scalars(select(User)).all()
```

### FastAPI session dependency

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

### Read one

```python
user = db.get(User, user_id)
```

### Filter

```python
user = db.scalar(
    select(User).where(User.email == email)
)
```

### Create

```python
db.add(user)
db.commit()
db.refresh(user)
```

### Update

```python
user.is_active = False
db.commit()
db.refresh(user)
```

### Delete

```python
db.delete(user)
db.commit()
```

### Handle a failed write

```python
try:
    db.commit()
except SQLAlchemyError:
    db.rollback()
    raise
```

### Safe raw SQL

```python
db.execute(
    text("SELECT * FROM users WHERE email = :email"),
    {"email": email},
)
```

If you understand why the engine is global, why the session is request-scoped, how the session's transaction is committed or rolled back, how models map to tables, and why every query must enforce authorization, you understand the core database architecture of this FastAPI project.
