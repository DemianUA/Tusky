const fs = require('fs');
const path = require('path');
const tokensFile = path.join(__dirname, 'tokens.txt');

function generateUserAgent() {
  const platforms = [
    'Windows NT 10.0; Win64; x64',
    'Macintosh; Intel Mac OS X 10_15_7',
    'X11; Linux x86_64'
  ];
  const browsers = [
    {
      name: 'Chrome',
      base: 'AppleWebKit/537.36 (KHTML, like Gecko)',
      suffix: 'Safari/537.36',
      version: () => `${Math.floor(Math.random() * 10) + 100}.0.${Math.floor(Math.random() * 9999)}.0`
    },
    {
      name: 'Firefox',
      base: 'Gecko/20100101',
      suffix: '',
      version: () => `${Math.floor(Math.random() * 20) + 90}.0`
    },
    {
      name: 'Safari',
      base: 'AppleWebKit/605.1.15 (KHTML, like Gecko)',
      suffix: 'Version/16.0 Safari/605.1.15',
      version: () => ''
    }
  ];

  const platform = platforms[Math.floor(Math.random() * platforms.length)];
  const browser = browsers[Math.floor(Math.random() * browsers.length)];
  const version = browser.version();

  if (browser.name === 'Firefox') {
    return `Mozilla/5.0 (${platform}; rv:${version}) ${browser.base} Firefox/${version}`;
  } else if (browser.name === 'Safari') {
    return `Mozilla/5.0 (${platform}) ${browser.base} ${browser.suffix}`;
  } else {
    return `Mozilla/5.0 (${platform}) ${browser.base} Chrome/${version} ${browser.suffix}`;
  }
}


function generateFingerprintFromUserAgent(uaString) {
  const platformMap = {
    'Windows': 'Win32',
    'Macintosh': 'MacIntel',
    'Linux': 'Linux x86_64'
  };

  const osKey = Object.keys(platformMap).find(key => uaString.includes(key));
  const platform = platformMap[osKey] || 'Win32';

  return {
    doNotTrack: Math.random() > 0.5 ? '1' : '0',
    language: 'en-US',
    platform: platform,
    hardwareConcurrency: Math.floor(Math.random() * 4) + 4, // 4–8
    maxTouchPoints: 0,
    deviceMemory: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
    vendor: 'Google Inc.',
    screen: {
      width: 1920,
      height: 1080,
      colorDepth: 24
    }
  };
}

function loadTokens() {
  if (!fs.existsSync(tokensFile)) return {};
  const lines = fs.readFileSync(tokensFile, 'utf-8').split('\n').filter(Boolean);
  const tokens = {};
  for (const line of lines) {
    try {
      const token = JSON.parse(line);
      if (token.address) {
        tokens[token.address.toLowerCase()] = token;
      }
    } catch (e) {
      console.error('❌ Failed to parse token line:', line);
    }
  }
  return tokens;
}

function saveTokens(tokens) {
  const lines = Object.values(tokens).map(t => JSON.stringify(t));
  fs.writeFileSync(tokensFile, lines.join('\n'), 'utf-8');
}

function getOrCreateTokenForAddress(address) {
  const tokens = loadTokens();
  const addr = address.toLowerCase();
  let token = tokens[addr];

  if (!token) {
    const userAgent = generateUserAgent();
    const fingerprint = generateFingerprintFromUserAgent(userAgent);

    token = {
      address: addr,
      userAgent,
      fingerprint,
      jwt: null
    };
    tokens[addr] = token;
    saveTokens(tokens);
    console.log(`✅ Created new token with fingerprint for ${address}`);
  }

  return token;
}

module.exports = {
  getOrCreateTokenForAddress,
  loadTokens,
  saveTokens
};
