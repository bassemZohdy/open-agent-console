FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run typecheck && npm run build

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="Open Agent Console" \
      org.opencontainers.image.description="Self-contained control panel and runtime for lightweight AI agents" \
      org.opencontainers.image.source="https://github.com/bassemZohdy/open-agent-console"
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_FILE_NAME=/data/open-agent-console.db DB_MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/index.html ./index.html
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/server/index.js"]
