# Quick Start Guide - FinSight Advisor Backend

## 5-Minute Setup

### Prerequisites
- PostgreSQL 12+ running
- Python 3.9+
- pip or conda

### Steps

```bash
# 1. Navigate to backend
cd backend

# 2. Install dependencies (2-3 min for first-time with torch)
pip install -r requirements.txt

# 3. Create .env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://postgres:password@localhost:5432/finsight
SECRET_KEY=dev-secret-key-change-in-production
ENV=development
DEBUG=True
EOF

# 4. Create PostgreSQL database
createdb finsight

# 5. Apply schema
psql finsight < schema.sql

# 6. Start server
uvicorn app.main:app --reload

# Server runs at http://localhost:8000
# API Docs at http://localhost:8000/api/docs
```

## Test It Out

### 1. Login
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}'
```

Save the `access_token` from response.

### 2. Upload Transactions
```bash
TOKEN="<your-access-token>"

curl -X POST http://localhost:8000/transactions/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sample.csv" \
  -F "dept_id=660e8400-e29b-41d4-a716-446655440001"
```

### 3. Group Transactions (SBERT)
```bash
curl -X POST http://localhost:8000/grouping/assign-groups \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dept_id":"660e8400-e29b-41d4-a716-446655440001"}'
```

### 4. Categorize
```bash
curl -X POST http://localhost:8000/categorization/predict \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dept_id":"660e8400-e29b-41d4-a716-446655440001"}'
```

### 5. Run Forensic Analysis
```bash
curl -X POST http://localhost:8000/forensic/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dept_id":"660e8400-e29b-41d4-a716-446655440001","month":2,"year":2025}'
```

## API Documentation

Visit: http://localhost:8000/api/docs

Interactive Swagger UI for testing all endpoints.

## Demo Credentials

| Email | Password | Company | Role |
|-------|----------|---------|------|
| john@techcorp.com | password123 | TechCorp | Admin |
| jane@techcorp.com | password123 | TechCorp | User |
| bob@financeflow.com | password123 | FinanceFlow | Admin |

## Common Issues

**Port 8000 already in use:**
```bash
uvicorn app.main:app --port 8001
```

**Database connection failed:**
```bash
psql -U postgres -c "CREATE DATABASE finsight;"
psql finsight < schema.sql
```

**Missing dependencies:**
```bash
pip install --upgrade pip
pip install -r requirements.txt --force-reinstall
```

## Project Architecture

```
Request → FastAPI → Auth Middleware → Router → SQLAlchemy ORM → PostgreSQL
                                                    ↓
                                         SBERT / Forensic / Budget Models
```

All routers register in `app/main.py` and share the same database session.

## What's Implemented

✅ Full PostgreSQL backend with 12 tables
✅ JWT authentication with refresh tokens
✅ CSV/XLSX transaction upload with deduplication
✅ SBERT semantic grouping (chart of accounts)
✅ Frequency-based transaction categorization
✅ ARIMA budget forecasting with gap handling
✅ 3 forensic anomaly detection methods:
   - Benford's Law (first digit analysis)
   - Z-Score (outlier detection within groups)
   - Relative Size Factor (unusual amounts)
✅ Admin user & department management
✅ Audit logging
✅ Role-based access control

## Next: Frontend Integration

Update your React frontend to:

1. Call `/auth/login` endpoint
2. Store tokens in localStorage
3. Add `Authorization: Bearer <token>` header to all requests
4. Call transaction endpoints for upload/filter
5. Display forensic anomalies and categorization results

See [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) for full API reference.

---

## Troubleshooting

### SQLAlchemy Error: "could not connect"
```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1;"

# Verify DATABASE_URL in .env
# Default: postgresql://postgres:password@localhost:5432/finsight
```

### Missing module errors
```bash
pip install -r requirements.txt
# Wait for torch to download (it's large)
```

### SBERT model download slow
- First run downloads ~100MB model
- Subsequent runs use cached version
- Check `.cache/torch/sentence_transformers/`

### Port already in use
```bash
lsof -i :8000
kill -9 <PID>
# Or use different port: uvicorn app.main:app --port 8001
```

## Support

For issues, check:
1. Error messages in terminal output
2. IMPLEMENTATION_GUIDE.md for API reference
3. API documentation at http://localhost:8000/api/docs
4. Database logs: `psql -U postgres -d finsight -c "SELECT * FROM access_log;"`

Enjoy! 🚀
