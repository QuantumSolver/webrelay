#!/bin/bash

# ===========================================
# Generate Secure Secrets for WebRelay
# ===========================================
# This script generates cryptographically secure random values
# for all sensitive configuration in the .env file

set -e

echo "🔐 Generating secure secrets for WebRelay..."
echo ""

# Function to generate secure random string
generate_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# Generate secrets
REDIS_PASSWORD=$(generate_secret)
ADMIN_PASSWORD=$(generate_secret)
NEXTAUTH_SECRET=$(generate_secret)
JWT_SECRET=$(generate_secret)
ENCRYPTION_KEY=$(generate_secret)

echo "Generated secrets:"
echo "=================="
echo "REDIS_PASSWORD=$REDIS_PASSWORD"
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
echo "JWT_SECRET=$JWT_SECRET"
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY"
echo ""

# Update .env file
if [ -f .env ]; then
    echo "📝 Updating .env file..."
    sed -i.bak "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDIS_PASSWORD/" .env
    sed -i.bak "s/ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$ADMIN_PASSWORD/" .env
    sed -i.bak "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=$NEXTAUTH_SECRET/" .env
    sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    sed -i.bak "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
    rm .env.bak
    echo "✅ .env file updated successfully!"
else
    echo "❌ Error: .env file not found!"
    exit 1
fi

echo ""
echo "⚠️  IMPORTANT: Save these secrets securely!"
echo "   If you lose them, you'll need to regenerate and update your configuration."
echo ""
echo "✨ Done! Your WebRelay is now configured with secure secrets."
