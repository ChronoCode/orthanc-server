
# --- Build stage: Vite outputs to /dist ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime: nginx serves static files ---
FROM nginx:1.25-alpine AS runtime
RUN apk add --no-cache gettext  # for envsubst

COPY --from=builder /app/dist /usr/share/nginx/html
COPY public/config.js /usr/share/nginx/html/config.js.template
COPY nginx/app.conf    /etc/nginx/conf.d/default.conf

CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/config.js.template > /usr/share/nginx/html/config.js && nginx -g 'daemon off;'"]