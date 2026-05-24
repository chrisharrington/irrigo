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

# Re-run install on each start so package.json / bun.lock changes from the
# bind mount land in the anonymous /app/node_modules volume. Near no-op when
# the lock already matches what's installed. NODE_ENV is forced for the
# install step so drizzle-kit and other devDeps come along even though the
# image's default NODE_ENV is production.
ENTRYPOINT ["sh", "-c", "NODE_ENV=development bun install --frozen-lockfile && exec \"$0\" \"$@\""]
CMD ["bun", "start"]
