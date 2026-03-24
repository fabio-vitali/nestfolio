FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

COPY dist/ ./dist/

ENV AGENT_RUNTIME=true
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/runtime/server.js"]
