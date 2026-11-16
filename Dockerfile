FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY server.py ./
COPY engine ./engine
COPY web ./web

EXPOSE 8000

CMD ["python", "-u", "server.py"]
