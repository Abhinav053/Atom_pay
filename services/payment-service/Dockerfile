FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3003
CMD ["node", "services/payment-service/index.js"]
