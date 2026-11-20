FROM node:22-bookworm-slim

ARG TARGETARCH
ARG YTDLP_BASE=https://github.com/yt-dlp/yt-dlp/releases/latest/download

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp build (no Python runtime needed). Rebuild the image to update it.
RUN set -eux; \
    if [ "$TARGETARCH" = "arm64" ]; then URL="$YTDLP_BASE/yt-dlp_linux_aarch64"; \
    else URL="$YTDLP_BASE/yt-dlp_linux"; fi; \
    curl -fsSL "$URL" -o /usr/local/bin/yt-dlp; \
    chmod +x /usr/local/bin/yt-dlp; \
    yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY public ./public

RUN mkdir -p /app/downloads && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
