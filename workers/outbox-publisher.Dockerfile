FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "workers/outbox-publisher.js"]
