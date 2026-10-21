FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY drizzle ./drizzle
COPY scripts/local-server.mjs ./scripts/local-server.mjs
ENV HOST=0.0.0.0 PORT=4173 DATABASE_PATH=/data/team.sqlite
VOLUME /data
EXPOSE 4173
CMD ["node","scripts/local-server.mjs"]
