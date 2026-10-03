ARG NODE_IMAGE=node:24.19.0-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /opt/card
COPY bridge/package.json bridge/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bridge/ ./
RUN groupadd --gid 10002 cards && useradd --uid 10002 --gid cards --no-create-home cards && mkdir state && chown cards:cards state
USER 10002:10002
CMD ["node", "src/server.mjs"]
