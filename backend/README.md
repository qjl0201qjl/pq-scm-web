# PQ-SCM FastAPI backend

Run locally:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The frontend uses `VITE_API_BASE_URL` when set, otherwise `http://127.0.0.1:8000`.
