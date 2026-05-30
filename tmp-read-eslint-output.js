const { readFileSync } = require('fs');
const text = readFileSync('eslint-output.txt', 'utf16le');
process.stdout.write(text.slice(0, 12000));
