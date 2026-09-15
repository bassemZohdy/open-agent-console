FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run typecheck && npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_FILE_NAME=/data/open-agent-console.db
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/index.html ./index.html
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist/server/index.js"]
