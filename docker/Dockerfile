FROM node:22-bookworm-slim

WORKDIR /app

COPY panel/package.json panel/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY panel/server ./server
COPY panel/public ./public
COPY console/awq /usr/local/bin/awq
COPY docker/host-tool.sh /usr/local/libexec/awq-host/awg

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && chmod 755 /usr/local/bin/awq /usr/local/libexec/awq-host/awg \
  && cp /usr/local/libexec/awq-host/awg /usr/local/libexec/awq-host/awg-quick \
  && mkdir -p /data

ENV NODE_ENV=production \
    PORT=51821 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PATH=/usr/local/libexec/awq-host:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 51821
VOLUME /data
CMD ["node", "server/index.js"]
