FROM node:20-bookworm-slim

# build-essential + python3 so better-sqlite3 can compile from source on
# any architecture if a prebuilt binary isn't available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY admin ./admin

RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 8080 8081

CMD ["node", "server/index.js"]
