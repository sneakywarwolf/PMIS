#!/bin/bash
set -e

echo "============================================"
echo "VAPT Command Center - Setup Script"
echo "============================================"
echo ""

# Check if Docker is running
if ! docker ps >/dev/null 2>&1; then
    echo "[ERROR] Docker is not running. Please start Docker first."
    exit 1
fi

# Start infrastructure
echo "[1/6] Starting Docker infrastructure..."
docker-compose up -d

# Wait for services
echo "[2/6] Waiting for services to start..."
sleep 5

# Setup backend
echo "[3/6] Setting up backend..."
cd apps/backend

if [ ! -f .env ]; then
    cp ../../.env.example .env
    echo "Created .env file from template"
fi

echo "[4/6] Installing backend dependencies..."
npm install

echo "[5/6] Setting up database..."
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed

echo "[6/6] Starting backend server..."
npm run start:dev &
BACKEND_PID=$!

cd ../..

# Setup frontend
echo "Starting frontend setup..."
cd apps/frontend

echo "Installing frontend dependencies..."
npm install

echo "Starting frontend server..."
npm run dev &
FRONTEND_PID=$!

cd ../..

echo ""
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "Services:"
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:4000"
echo "  Swagger:   http://localhost:4000/api/docs"
echo "  MinIO:     http://localhost:9001"
echo ""
echo "Default Login:"
echo "  Username: admin"
echo "  Password: Admin@1234567890!"
echo ""

# Keep script running
wait
