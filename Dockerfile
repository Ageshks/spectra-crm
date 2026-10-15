FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl tini \
  && addgroup -S app && adduser -S app -G app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force \
  && chown -R app:app /app
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
