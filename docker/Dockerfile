FROM node:22-bookworm-slim

WORKDIR /app

COPY panel/package.json panel/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY panel/server ./server
COPY panel/public ./public

RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production \
    PORT=51821 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

EXPOSE 51821
VOLUME /data
USER node
CMD ["node", "server/index.js"]
