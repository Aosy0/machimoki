FROM node:20-slim

WORKDIR /app

# Install dependencies for node-gyp and other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
