FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
