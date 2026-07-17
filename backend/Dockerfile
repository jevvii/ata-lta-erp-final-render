# ATA & LTA ERP Backend
# Multi-stage build for production deployment on AWS ECS Fargate.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy dependencies and source
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

USER node
EXPOSE 3000
CMD ["node", "src/app.js"]
