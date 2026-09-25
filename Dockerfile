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
RUN cd web && npm run build

# ── test stage: build + real media tools, runs `npm test` for real ──
FROM build AS test
RUN apk add --no-cache vips-tools vips-heif ffmpeg exiftool
WORKDIR /app/server
ENV VITEST=true
CMD ["npm", "test"]

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
