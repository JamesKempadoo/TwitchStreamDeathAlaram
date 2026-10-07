/**
 * Build script to generate config.js from .env file or environment variables
 * Runs locally or during CI/CD build step.
 */
const fs = require('fs');
const path = require('path');

let clientId = process.env.TWITCH_CLIENT_ID || '';

// Try reading .env file if process.env.TWITCH_CLIENT_ID is not set
const envPath = path.join(__dirname, '.env');
if (!clientId && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/TWITCH_CLIENT_ID\s*=\s*["']?([^"'\r\n]+)["']?/);
  if (match) {
    clientId = match[1].trim();
  }
}

const configContent = `// Auto-generated runtime configuration
window.CONFIG = {
  TWITCH_CLIENT_ID: "${clientId}"
};
`;

fs.writeFileSync(path.join(__dirname, 'config.js'), configContent, 'utf8');
console.log(`[Build] config.js generated successfully. Client ID status: ${clientId ? 'Loaded ✓' : 'Empty (Set TWITCH_CLIENT_ID in .env)'}`);
