FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.mjs ./bundle.mjs
ENV AGENT_RUNTIME=true
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.mjs"]
# rev: 1776811114
