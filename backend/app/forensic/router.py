from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from .forensic_analysis import benford_analysis, zscore_analysis, rsf_analysis

router = APIRouter(
    prefix="/forensic",
    tags=["Forensic Analysis"]
)

# --- Request Models ---

class Transaction(BaseModel):
    transaction_date: str
    amount: float
    group: Optional[str] = None

class TransactionList(BaseModel):
    transactions: List[Transaction]

# --- Endpoints ---

@router.post("/benford")
def run_benford(data: TransactionList):
    transactions = [t.dict() for t in data.transactions]
    result = benford_analysis(transactions)
    return result

@router.post("/zscore")
def run_zscore(data: TransactionList):
    transactions = [t.dict() for t in data.transactions]
    result = zscore_analysis(transactions)
    return result

@router.post("/rsf")
def run_rsf(data: TransactionList):
    transactions = [t.dict() for t in data.transactions]
    result = rsf_analysis(transactions)
    return result

@router.post("/full")
def run_full_analysis(data: TransactionList):
    """Run all three forensic analyses at once."""
    transactions = [t.dict() for t in data.transactions]
    return {
        "benford": benford_analysis(transactions),
        "zscore": zscore_analysis(transactions),
        "rsf": rsf_analysis(transactions)
    }