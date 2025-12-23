import fs from 'fs';
import path from 'path';
import os from 'os';

// Config directory and file paths
const CONFIG_DIR = path.join(os.homedir(), '.beetle');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface BeetleConfig {
  authToken?: string;
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Get the current configuration
 */
export function getConfig(): BeetleConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty config on error
  }
  return {};
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: BeetleConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get the stored auth token
 */
export function getAuthToken(): string | undefined {
  return getConfig().authToken;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

/**
 * Save auth token and user details
 */
export function saveAuth(token: string, userDetails?: Partial<BeetleConfig>): void {
  const config = getConfig();
  saveConfig({
    ...config,
    authToken: token,
    ...userDetails,
  });
}

/**
 * Clear authentication (logout)
 */
export function clearAuth(): void {
  const config = getConfig();
  delete config.authToken;
  delete config.userId;
  delete config.email;
  delete config.firstName;
  delete config.lastName;
  delete config.imageUrl;
  saveConfig(config);
}

/**
 * Get the config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
