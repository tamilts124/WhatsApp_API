# Use Ubuntu 22.04 as the base image
FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and Node.js
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code (outputs to /dist)
RUN npm run build

# Expose the API port
EXPOSE 3000

# Start the application using the compiled JavaScript
CMD ["node", "dist/server.js"]
