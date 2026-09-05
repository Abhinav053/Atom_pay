FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3002
CMD ["node", "services/wallet-service/index.js"]
