FROM node:22-alpine AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN VITE_API_BASE_URL= npm run build:pages

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV HSTS_ENABLED=true
ENV COOKIE_SECURE=true
ENV RATE_LIMIT_ENABLED=true
ENV ALLOWED_HOSTS=localhost,127.0.0.1

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

CMD ["sh", "-c", "uvicorn app.main:app --app-dir /app/api --host 127.0.0.1 --port 8000 & envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
