# Stage 1: Build Environment
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for build)
COPY package*.json ./
RUN npm install

# Copy source code and build the project
COPY . .
RUN npm run build

# Stage 2: Runtime Environment (Lightweight)
FROM node:22-slim

WORKDIR /app

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy only the compiled JavaScript from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the API port
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]
