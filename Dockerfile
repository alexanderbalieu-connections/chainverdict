FROM node:24.22.1-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps/traderails/package*.json ./apps/traderails/
RUN npm ci --prefix apps/traderails --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY apps/traderails ./apps/traderails
ENV NODE_ENV=production
RUN mkdir -p /home/node/.ssh && chown node:node /home/node/.ssh && chmod 0700 /home/node/.ssh
USER node
EXPOSE 10000
CMD ["node", "--max-old-space-size=64", "scripts/serve-apis.mjs"]
