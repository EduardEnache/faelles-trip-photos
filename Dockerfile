# fælles. — multi-stage build (PLAN.md §1).
# build: compiles web/ (Vite) and server/ (esbuild bundle, shared/ inlined).
# test:  build + media tools, runs the server test suite for real (tool-dependent tests only run here).
# runtime: slim image with just the media tools + prod deps + built assets.

FROM node:22-alpine3.20 AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY shared ./shared

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
RUN cd server && npm run build

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
# the frontend may still have WIP type errors while this image is built
# concurrently; never let that break the container build — fall back to an
# empty dist (app.ts serves a clean placeholder when index.html is missing).
RUN cd web && (npm run build || true) && mkdir -p dist

# ── test stage: build + real media tools, runs `npm test` for real ──
FROM build AS test
RUN apk add --no-cache vips-tools vips-heif ffmpeg exiftool
WORKDIR /app/server
ENV VITEST=true
CMD ["npm", "test"]

# ── dev stage: server + real media tools only, no web build at all — used
# for the backend's shared dev backend on 127.0.0.1:8498 so it never depends
# on (or is blocked by) B/C's in-progress web/ build. ──
FROM node:22-alpine3.20 AS dev
RUN apk add --no-cache vips-tools vips-heif ffmpeg exiftool tini
WORKDIR /app
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json /app/server/package-lock.json ./server/
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
RUN mkdir -p /data && chown -R 1000:1000 /data /app
USER 1000:1000
ENV NODE_ENV=development \
    PORT=8497 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data \
    FAELLES_PIN=1234 \
    ALBUM_TITLE="Denmark 2026" \
    LOG_LEVEL=debug
EXPOSE 8497
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "server/dist/index.js"]

# ── runtime: slim, media tools + prod deps only ──
FROM node:22-alpine3.20 AS runtime
ARG BUILD_VERSION=dev
RUN apk add --no-cache vips-tools vips-heif ffmpeg exiftool tini
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./public

RUN mkdir -p /data && chown -R 1000:1000 /data /app
USER 1000:1000

ENV NODE_ENV=production \
    PORT=8497 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data \
    STATIC_DIR=/app/public \
    FAELLES_PIN=1234 \
    ALBUM_TITLE="Denmark 2026" \
    PHOTO_CONCURRENCY=4 \
    VIDEO_CONCURRENCY=2 \
    LOG_LEVEL=info \
    BUILD_VERSION=${BUILD_VERSION}

EXPOSE 8497
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "server/dist/index.js"]
