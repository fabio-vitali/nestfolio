FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV AGENT_RUNTIME=true
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
