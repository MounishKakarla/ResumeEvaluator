# Resume Evaluation System

A full-stack AI-powered resume evaluation system.

## Features
- **Backend**: Python + FastAPI — PDF/DOCX parsing, NLP scoring, REST API
- **Frontend**: React + Vite + Tailwind CSS — Admin dashboard, leaderboard, candidate detail
- **NLP**: sentence-transformers (cosine similarity) + spaCy (section detection, confidence scoring)
- **Storage**: SQLite for dev, PostgreSQL-ready schema for prod
- **Auth**: JWT-based admin authentication with role separation

## Running Locally

Requirements:
- Docker and Docker Compose

Run the application:
```bash
docker compose up --build
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
