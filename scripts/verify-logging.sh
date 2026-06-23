#!/bin/bash
set -e

echo "--- Verifying Build Integrity ---"

# 1. Verify npm run build exits with code 0
echo "Running build..."
npm run build
if [ $? -eq 0 ]; then
    echo "✅ Build successful."
else
    echo "❌ Build failed."
    exit 1
fi

# 2. Assert logger output is valid JSON
echo "Verifying logger output format..."
# Run a script that uses the logger and check if output is JSON
node -e "const logger = require('./dist/utils/logger').default; logger.info('test message')" > test_log.txt
if jq . test_log.txt > /dev/null 2>&1; then
    echo "✅ Logger output is valid JSON."
else
    echo "❌ Logger output is NOT valid JSON."
    rm test_log.txt
    exit 1
fi
rm test_log.txt

# 3. Check LOG_LEVEL environment variable
echo "Verifying LOG_LEVEL respect..."
export LOG_LEVEL=error
node -e "const logger = require('./dist/utils/logger').default; logger.info('should not show'); logger.error('should show')" > level_test.txt
LOG_COUNT=$(grep -c "should show" level_test.txt || true)
NO_SHOW_COUNT=$(grep -c "should not show" level_test.txt || true)

if [ "$LOG_COUNT" -eq 1 ] && [ "$NO_SHOW_COUNT" -eq 0 ]; then
    echo "✅ LOG_LEVEL is correctly respected."
else
    echo "❌ LOG_LEVEL check failed."
    rm level_test.txt
    exit 1
fi
rm level_test.txt

echo "--- All checks passed! ---"
