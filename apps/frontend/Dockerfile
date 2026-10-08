FROM node:26-bookworm-slim AS builder

WORKDIR /app
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN pnpm install --frozen-lockfile
COPY contributors ./contributors
COPY apps/frontend ./apps/frontend
ENV VITE_API_BASE_URL=/api
ENV VITE_BASE_PATH=/
RUN pnpm --dir apps/frontend build

FROM nginx:1.29-alpine

ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV PORT=80
ENV API_INTERNAL_URL=http://127.0.0.1:9
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/frontend/build/client /usr/share/nginx/html

EXPOSE 80
