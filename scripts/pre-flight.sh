#!/bin/bash
# Pre-flight check script to ensure environment integrity before pushing to CI.
set -e

echo "🚀 Starting Pre-flight Check..."

# 1. Dependency Sync
echo "📦 Step 1: Synchronizing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ npm install failed. Please check your package.json."
    exit 1
fi

# 2. Build Check
echo "🏗️ Step 2: Running build..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed. Check for compilation errors."
    exit 1
fi

# 3. Test Suite
echo "🧪 Step 3: Running unit tests..."
npm test
if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Fix the broken tests before pushing."
    exit 1
fi

# 4. Lockfile Integrity
echo "🔍 Step 4: Verifying lockfile is in sync..."
git diff --exit-code package-lock.json > /dev/null || (echo "⚠️ package-lock.json is out of sync with package.json. Staging it now..." && git add package-lock.json)

echo "✅ Pre-flight Check Passed! You are ready to push."
