const axios = require('axios');
const dotenv = require('dotenv');
const readline = require('readline');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const { loadTokens, saveTokens } = require('./tokenStore');
const path = require('path');
const { getOrCreateTokenForAddress } = require('./tokenStore');


dotenv.config();

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
};

const generateRandomFingerprint = () => ({
  deviceMemory: [4, 8, 16][Math.floor(Math.random() * 3)],
  hardwareConcurrency: [2, 4, 8][Math.floor(Math.random() * 3)],
  platform: ['Win32', 'Linux x86_64', 'MacIntel'][Math.floor(Math.random() * 3)],
  language: ['en-US', 'en-GB', 'uk-UA'][Math.floor(Math.random() * 3)],
});

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`---------------------------------------------`);
    console.log(`  Tusky Bot - Crypto Travels `);
    console.log(`---------------------------------------------`);
    console.log(`  t.me/CryptoTravelsWithDmytro `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  },
};

const generateRandomUserAgent = () => {
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
};


const getCommonHeaders = (authToken = null, userAgent = null) => {
  const ua = userAgent || generateUserAgent();  // generateUserAgent із tokenStore
  const platform = ua.includes('Win') ? '"Windows"' : ua.includes('Mac') ? '"macOS"' : '"Linux"';
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.8',
    'content-type': 'application/json',
    'client-name': 'Tusky-App/dev',
    priority: 'u=1, i',
    'sdk-version': 'Tusky-SDK/0.31.0',
    'User-Agent': ua,
    'sec-ch-ua': ua,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    Referer: 'https://app.tusky.io/',
    ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
  };
};


const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    logger.info(`Loaded ${proxies.length} proxies from proxies.txt`);
    return proxies;
  } catch (error) {
    logger.warn('No proxies found in proxies.txt or file does not exist. Using direct mode.');
    return [];
  }
};

const createAxiosInstance = (proxyUrl = null) => {
  if (proxyUrl) {
    try {
      logger.info(`Using proxy: ${proxyUrl}`);
      return axios.create({
        httpsAgent: new HttpsProxyAgent(proxyUrl),
      });
    } catch (error) {
      logger.warn(`Invalid proxy format: ${proxyUrl}. Falling back to direct mode.`);
      return axios.create();
    }
  }
  logger.info('Using direct mode (no proxy)');
  return axios.create();
};

const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

const loginWallet = async (account, proxyUrl) => {
  logger.step(`Starting wallet login process for account ${account.index} (${account.type})`);
  try {
    // 1. Отримуємо ключі та адресу акаунта
    const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
    let keypair;
    if (account.mnemonic) {
    const mnemonic = account.mnemonic;
  keypair = await Ed25519Keypair.deriveKeypair(mnemonic);
    } else if (account.privateKey) {
     const privateKeyBytes = decodeSuiPrivateKey(account.privateKey);
  keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes.secretKey);
    } else {
      throw new Error(`No valid private key or mnemonic for account ${account.index}`);
    }
    const address = keypair.getPublicKey().toSuiAddress();
    logger.info(`Processing address: ${address}`);

    // 2. Завантажуємо/генеруємо userAgent і fingerprint для цієї адреси
    const tokenData = getOrCreateTokenForAddress(address);
if (!tokenData.proxy && proxyUrl) {
  tokenData.proxy = proxyUrl;
  const allTokens = loadTokens();
  allTokens[address.toLowerCase()] = tokenData;
  saveTokens(allTokens);
  logger.info(`🔒 Зафіковано проксі ${proxyUrl} для ${address}`);
}
    const userAgent = tokenData.userAgent;
    const fingerprint = tokenData.fingerprint;

    // 3. Перевіряємо, чи вже є збережений idToken (JWT) для цієї адреси
    if (tokenData.idToken) {
      logger.success(`Using cached token for address ${address}`);
      // Повертаємо відразу, уникаючи повторного логіну
      account.address = address;
      account.userAgent = userAgent;
      account.fingerprint = fingerprint;
      return {
        idToken: tokenData.idToken,
        address,
        userAgent,
        fingerprint,
        accountIndex: account.index
      };
    }

    // 4. Виконуємо процес логіну через API Tusky
    // 4.1. Запит на створення челенджу (nonce)
    const challengeResponse = await axios.post(
      'https://api.tusky.io/auth/create-challenge?',
      { address },
      { headers: getCommonHeaders(null, userAgent) }    // використовуємо User-Agent акаунта
    );
    const nonce = challengeResponse.data.nonce;
    const message = `tusky:connect:${nonce}`;
    logger.info(`Signing message: ${message}`);
    const messageBytes = new TextEncoder().encode(message);
    const signatureData = await keypair.signPersonalMessage(messageBytes);
    const signature = signatureData.signature;
    logger.info(`Generated signature: ${signature}`);

const verifyBody = { address, signature };


const verifyResponse = await axios.post(
  'https://api.tusky.io/auth/verify-challenge?',
  verifyBody,
  { headers: getCommonHeaders(null, userAgent) }
);


    const idToken = verifyResponse.data.idToken;
    logger.success(`Successfully logged in for address ${address}`);

    // 5. Зберігаємо отриманий токен разом із User-Agent та fingerprint
    tokenData.idToken = idToken;
    const allTokens = loadTokens();
    allTokens[address.toLowerCase()] = {
      address: address.toLowerCase(),
      idToken,
      userAgent,
      fingerprint,
      proxy: tokenData.proxy
    };
    saveTokens(allTokens);
    logger.info(`Token + fingerprint saved for ${address}`);

    // 6. Зберігаємо дані в об’єкт акаунта та повертаємо результат
    account.address = address;
    account.userAgent = userAgent;
    account.fingerprint = fingerprint;
    return { idToken, address, userAgent, fingerprint, accountIndex: account.index };
  } catch (error) {
    logger.error(`Failed to login for account ${account.index} (${account.type}): ${error.message}`);
    if (error.response) {
      logger.error(`API response: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
};


const fetchStorageInfo = async (idToken, axiosInstance, account) => {
  logger.step(`Fetching storage information for account ${account.index}`);
  try {
    const response = await axiosInstance.get('https://api.tusky.io/storage?', {
  headers: {
    ...getCommonHeaders(idToken, account.userAgent),
    'client-name': 'Tusky-App/dev',
      },
    });
    const { storageAvailable, storageTotal, photos, owner } = response.data;
    logger.info(`Storage Available: ${storageAvailable} bytes (~${(storageAvailable / 1000000).toFixed(2)} MB)`);
    logger.info(`Storage Total: ${storageTotal} bytes (~${(storageTotal / 1000000).toFixed(2)} MB)`);
    logger.info(`Photos Size: ${photos} bytes`);
    logger.info(`Owner: ${owner}`);
    return { storageAvailable, storageTotal, photos, owner };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logger.warn(`Token expired for account ${account.index}. Attempting to refresh token...`);
      const newToken = await loginWallet({
        privateKey: account.privateKey,
        mnemonic: account.mnemonic,
        index: account.index,
        type: account.type,
      });
      if (newToken) {
        account.idToken = newToken.idToken;
        logger.success(`Token refreshed for account ${account.index}`);
        return await fetchStorageInfo(account.idToken, axiosInstance, account);
      } else {
        logger.error(`Failed to refresh token for account ${account.index}`);
        throw new Error('Token refresh failed');
      }
    }
    logger.error(`Failed to fetch storage info for account ${account.index}: ${error.message}`);
    if (error.response) {
      logger.error(`API response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

const generateRandomVaultName = () => {
  const adjectives = ['Cosmic', 'Stellar', 'Lunar', 'Solar', 'Nebula', 'Galactic', 'Orbit', 'Astro'];
  const nouns = ['Vault', 'Storage', 'Chamber', 'Node', 'Hub', 'Cluster', 'Zone', 'Realm'];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${randomNum}`;
};

const createPublicVault = async (idToken, axiosInstance, account) => {
  logger.step(`Creating new public vault for account ${account.index}`);
  try {
    const vaultName = generateRandomVaultName();
    const vaultData = {
      name: vaultName,
      encrypted: false,
      tags: []
    };

    const response = await axiosInstance.post('https://api.tusky.io/vaults?', vaultData, {
  headers: {
    ...getCommonHeaders(idToken, account.userAgent),
    'client-name': 'Tusky-App/dev',
      },
    });

    const vault = response.data;
    logger.success(`Created new public vault: "${vault.name}" (${vault.id})`);
    
    return {
      id: vault.id,
      name: vault.name,
      rootFolderId: vault.id,
      size: vault.size || 0,
      owner: vault.owner
    };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logger.warn(`Token expired for account ${account.index}. Attempting to refresh token...`);
      const newToken = await loginWallet({
        privateKey: account.privateKey,
        mnemonic: account.mnemonic,
        index: account.index,
        type: account.type,
      });
      if (newToken) {
        account.idToken = newToken.idToken;
        logger.success(`Token refreshed for account ${account.index}`);
        return await createPublicVault(account.idToken, axiosInstance, account);
      } else {
        logger.error(`Failed to refresh token for account ${account.index}`);
        throw new Error('Token refresh failed');
      }
    }
    logger.error(`Failed to create vault for account ${account.index}: ${error.message}`);
    if (error.response) {
      logger.error(`API response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

const uploadFile = async (idToken, vault, axiosInstance, account) => {
  logger.step(`Uploading file to vault "${vault.name}" (${vault.id}) for account ${account.index}`);
  try {
    if (!isValidUUID(vault.id) || !isValidUUID(vault.rootFolderId)) {
      logger.error(`Invalid vaultId or rootFolderId format: vaultId=${vault.id}, rootFolderId=${vault.rootFolderId}`);
      throw new Error('Invalid UUID format');
    }

    const imagePaths = getRandomImagesFromLocalFolder(path.join(__dirname, 'images'));
const uploadIds = [];
for (const imagePath of imagePaths) {
  const imageBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const fileSize = imageBuffer.length;
  const mimeType = 'image/jpeg';

  const uploadMetadata = {
    vaultId: vault.id,
    parentId: vault.rootFolderId,
    relativePath: Buffer.from('null').toString('base64'),
    name: Buffer.from(fileName).toString('base64'),
    type: Buffer.from(mimeType).toString('base64'),
    filetype: Buffer.from(mimeType).toString('base64'),
    filename: Buffer.from(fileName).toString('base64'),
  };

  const uploadHeaders = {
    ...getCommonHeaders(idToken, account.userAgent),
    'content-type': 'application/offset+octet-stream',
    'tus-resumable': '1.0.0',
    'upload-length': fileSize.toString(),
    'upload-metadata': Object.entries(uploadMetadata)
      .map(([k, v]) => {
        if (['vaultId', 'parentId'].includes(k)) {
          return `${k} ${Buffer.from(v).toString('base64')}`;
        }
        return `${k} ${v}`;
      })
      .join(','),
  };

  const uploadParams = {
    vaultId: vault.id,
  };

  const uploadResponse = await axiosInstance.post('https://api.tusky.io/uploads', imageBuffer, {
    headers: uploadHeaders,
    params: uploadParams,
  });

  const uploadId = uploadResponse.data.uploadId;
uploadIds.push(uploadId);
  logger.success(`File uploaded to vault "${vault.name}", Upload ID: ${uploadId}`);
if (imagePath !== imagePaths[imagePaths.length - 1]) {
  const delay = Math.floor(Math.random() * 5000) + 5000; // 5–10 сек
  logger.info(`⏳ Waiting ${Math.floor(delay / 1000)}s before next upload...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}
}

    
    return uploadIds;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logger.warn(`Token expired for account ${account.index}. Attempting to refresh token...`);
      const newToken = await loginWallet({
        privateKey: account.privateKey,
        mnemonic: account.mnemonic,
        index: account.index,
        type: account.type,
      });
      if (newToken) {
        account.idToken = newToken.idToken;
        logger.success(`Token refreshed for account ${account.index}`);
        return await uploadFile(account.idToken, vault, axiosInstance, account);
      } else {
        logger.error(`Failed to refresh token for account ${account.index}`);
        throw new Error('Token refresh failed');
      }
    }
    logger.error(`Failed to upload file to vault "${vault.name}" for account ${account.index}: ${error.message}`);
    if (error.response) {
      logger.error(`API response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

const countdown = (seconds) => {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      process.stdout.write(
        `\r${colors.cyan}[⟳] Waiting for next daily run: ${hours}h ${minutes}m ${secs}s${colors.reset}`
      );
      seconds--;
      if (seconds < 0) {
        clearInterval(interval);
        process.stdout.write('\n');
        resolve();
      }
    }, 1000);
  });
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const runUploads = async (account, proxyUrl, numberOfUploads) => {
  try {
    const idToken = account.idToken;
    logger.step(`Using token for address ${account.address}: ${idToken.slice(0, 20)}...`);
const tokenData = getOrCreateTokenForAddress(account.address);

    const axiosInstance = createAxiosInstance(tokenData.proxy || proxyUrl);

    await fetchStorageInfo(idToken, axiosInstance, account);

    const vault = await createPublicVault(idToken, axiosInstance, account);
    logger.info(`Using newly created vault: "${vault.name}" (${vault.id})`);

    for (let i = 0; i < numberOfUploads; i++) {
      logger.step(`Upload ${i + 1} of ${numberOfUploads} to vault "${vault.name}"`);
      await uploadFile(idToken, vault, axiosInstance, account);
      logger.success(`Upload ${i + 1} completed for account ${account.index}`);

      if (i < numberOfUploads - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.success(`All ${numberOfUploads} uploads completed for account ${account.index}`);
  } catch (error) {
    logger.error(`Error processing uploads for account ${account.index}: ${error.message}`);
    if (error.response) {
      logger.error(`API response: ${JSON.stringify(error.response.data)}`);
    }
  }
};

function getRandomImagesFromLocalFolder(folderPath, min = 1, max = 3) {
  const files = fs.readdirSync(folderPath).filter(file =>
    /\.(jpg|jpeg|png)$/i.test(file)
  );
  const count = Math.min(Math.max(min, Math.floor(Math.random() * (max - min + 1)) + min), files.length);
  const shuffled = files.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(file => path.join(folderPath, file));
}

const main = async () => {
  logger.banner();

  const numberOfUploads = 1;

  logger.info(`Will perform ${numberOfUploads} uploads daily`);

  const proxies = loadProxies();
  let proxyIndex = 0;

  const accounts = [];
  let i = 1;
  while (true) {
    const privateKey = process.env[`PRIVATE_KEY_${i}`];
    const mnemonic = process.env[`MNEMONIC_${i}`];
    if (!privateKey && !mnemonic) break;

    accounts.push({
      privateKey: privateKey || null,
      mnemonic: mnemonic || null,
      index: accounts.length + 1,
      type: privateKey ? 'privateKey' : 'mnemonic',
    });
    i++;
  }

  if (accounts.length === 0) {
    logger.error('No valid private keys or mnemonics found in .env file');
    rl.close();
    return;
  }

  logger.info(`Found ${accounts.length} accounts to process`);



  const shuffledAccounts = accounts.sort(() => 0.5 - Math.random());

 
for (let i = 0; i < shuffledAccounts.length; i++) {
  const account = shuffledAccounts[i];
  const proxyUrl = proxies[i % proxies.length]; // фіксована прив’язка

  if (i === 0) {
  logger.info(`⏩ Starting account ${account.index} immediately`);
} else {
  const delay = Math.floor(Math.random() * 90000) + 60000;
  logger.info(`⏳ Waiting ${Math.floor(delay / 1000)}s before starting account ${account.index}`);
  await new Promise(resolve => setTimeout(resolve, delay));
}


  logger.step(`Processing account ${account.index} (${account.type})`);

  try {
    const auth = await loginWallet(account, proxyUrl);

if (!auth) {
  logger.warn(`Skipping account ${account.index} due to login or upload failure`);
  continue;
}

account.idToken = auth.idToken;
account.address = auth.address;
account.userAgent = auth.userAgent;
account.fingerprint = auth.fingerprint;

await runUploads(account, proxyUrl, numberOfUploads);

  } catch (error) {
    logger.error(`Error processing account ${account.index}: ${error.message}`);
  }
}


  logger.success('Daily upload session completed for all accounts');
  const nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000);
  logger.info(`Next run scheduled at: ${nextRun.toLocaleString('en-US', { timeZone: 'Asia/Makassar' })}`);

  await countdown(24 * 60 * 60);
  rl.close();
};

main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  rl.close();
});
