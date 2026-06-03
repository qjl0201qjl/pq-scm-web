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

Core unified-state endpoints:

- `GET /api/state`: returns one backend source of truth for comments, ABSA, issue summary, QFD, supply-chain results, reports, counts, and current pipeline stage.
- `POST /api/pipeline/run`: runs ABSA -> diagnosis -> QFD -> supply chain, optionally report generation, then returns the same unified state.
- `POST /api/pipeline/run-full-analysis`: runs the LLM chain ABSA -> issue clustering -> Kano-FDA -> LLM-QFD -> LLM supply-chain recommendation, creates an `analysis_id`, and persists the full result.
- `GET /api/pipeline/current-analysis`: returns the latest persisted `full_analysis_result` by `analysis_id`.

Frontend pages should treat `/api/state` as the canonical data source after every generation step.
