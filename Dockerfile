FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api.py auth.py database.py document_jobs.py main.py worker.py sales.csv ./
RUN useradd --create-home --uid 10001 workbrief
USER workbrief
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
