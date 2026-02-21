#!/bin/sh
set -e

# Check if database exists, if not initialize it
if [ ! -f "/app/db/prisma.db" ]; then
    echo "📦 Database not found. Initializing Prisma database..."
    npx prisma db push --schema=/app/prisma/schema.prisma
    echo "✅ Database initialized successfully!"
else
    echo "✅ Database already exists. Skipping initialization."
fi

# Start the application
exec "$@"
