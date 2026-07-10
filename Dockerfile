FROM node:22-alpine AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN VITE_API_BASE_URL= npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV COOKIE_SECURE=true
ENV SECURITY_HEADERS_ENABLED=false
ENV PYTHONPATH=/app/api

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /run/nginx /usr/share/nginx/html

WORKDIR /app/api

COPY apps/api/pyproject.toml ./
COPY apps/api/app ./app

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -e ".[postgres]"

WORKDIR /app

COPY --from=web-build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

CMD ["sh", "-c", "python -m app.bootstrap && python -m app.v1_lite_seed --json && uvicorn app.main:app --app-dir /app/api --host 127.0.0.1 --port 8000 & envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
