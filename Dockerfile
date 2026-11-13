# One stage: build, then `npm prune --omit=dev`, which keeps the workspace symlink
# node_modules/@leaderboard/shared -> ../../shared intact. Builds from a clean checkout
# with a plain `docker build .` (no build args, no secrets).
FROM node:22-slim

WORKDIR /app

# Dependencies first so `npm ci` stays cached unless a package.json changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
# The vendored Bar Games SDK and game kit tarballs (file: dependencies).
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# Non-root, and only /data is written to (a Bar Games box runs the image with a
# read-only root filesystem, no capabilities, and a writable /data and /tmp).
RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production
ENV PORT=3008
ENV DATA_DIR=/data
EXPOSE 3008

CMD ["node", "server/dist/index.js"]
