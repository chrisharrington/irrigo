FROM oven/bun:latest AS runtime

WORKDIR /app

# Install dependencies first so the layer caches well and the anonymous
# /app/node_modules volume in docker-compose.yml initializes with deps.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . /app

ENV NODE_ENV=production \
    PORT=9753

EXPOSE 9753

# Run your app via bun
CMD ["bun", "start"]
