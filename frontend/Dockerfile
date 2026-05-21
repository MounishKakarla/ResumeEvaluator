# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Accept build-time VITE_ vars
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.25-alpine AS runner

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy the SPA build
COPY --from=builder /app/dist /usr/share/nginx/html

# SPA routing: unknown paths fall back to index.html
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
