from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.forensic.router import router as forensic_router
from app.grouping.router import router as grouping_router

app = FastAPI(
    title="FinSight Advisor API",
    description="Financial Transaction Intelligence Platform",
    version="1.0.0"
)

# CORS - allows React frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(forensic_router)
app.include_router(grouping_router)

@app.get("/")
def root():
    return {"message": "FinSight Advisor API is running!"}