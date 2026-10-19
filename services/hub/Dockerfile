# Build context: repository root (the image bundles the shared schemas).
FROM node:22-alpine AS build
WORKDIR /app
COPY services/hub/package.json services/hub/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY services/hub/tsconfig.json services/hub/tsconfig.build.json ./
COPY services/hub/src ./src
RUN npm run build && cp -r src/db/migrations dist/db/migrations && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production SCHEMAS_DIR=/app/schemas
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY schemas ./schemas
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "dist/server.js"]
