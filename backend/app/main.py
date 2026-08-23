from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.router import router as admin_router
from app.auth.router import router as auth_router
from app.budget.router import router as budget_router
from app.categorization.router import router as categorization_router
from app.database import init_db
from app.forensic.router import router as forensic_router
from app.forensic_engine.router import router as forensic_engine_router
from app.grouping.router import router as grouping_router
from app.seed import seed_demo_data
from app.transaction.router import router as transaction_router
from app.database import SessionLocal

app = FastAPI(
    title="FinSight Advisor API",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    if os.getenv("AUTO_SEED_DEMO", "True") == "True":
        db = SessionLocal()
        try:
            seed_demo_data(db)
        finally:
            db.close()


app.include_router(auth_router)
app.include_router(transaction_router)
app.include_router(grouping_router)
app.include_router(categorization_router)
app.include_router(budget_router)
app.include_router(forensic_router)
app.include_router(forensic_engine_router)
app.include_router(admin_router)


@app.get("/")
def root():
    return {"message": "FinSight Advisor API is running", "docs": "/api/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
