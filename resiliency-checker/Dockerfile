FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data /data-root && chown -R node:node /app /data-root
USER node
ENV PORT=5173
ENV DATA_ROOT=/data-root
EXPOSE 5173
CMD ["node", "server/index.js"]
