FROM oven/bun:latest AS runtime

WORKDIR /app

COPY . /app

ENV NODE_ENV=production \
    PORT=9753

EXPOSE 9753

# Run your app via bun
CMD ["bun", "start"]
