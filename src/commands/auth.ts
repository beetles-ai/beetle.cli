import http from 'http';
import { intro, outro, spinner, note, cancel, isCancel } from '@clack/prompts';
import pc from 'picocolors';
import open from 'open';
import { 
  saveAuth, 
  clearAuth, 
  isAuthenticated, 
  getConfig, 
  getConfigPath 
} from '../config.js';

// Base URL for beetle web app
const BEETLE_WEB_URL = process.env.BEETLE_WEB_URL || 'http://localhost:3000';

/**
 * Find an available port for the local auth callback server
 */
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Could not find available port'));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Decode JWT token to extract user details (without verification)
 */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Start local HTTP server and wait for auth callback
 */
function waitForAuthCallback(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      
      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const error = url.searchParams.get('error');
        
        // Send response to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Beetle CLI - Authentication</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  background: #0f0f0f;
                  color: #fff;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                }
                .icon { font-size: 64px; margin-bottom: 1rem; }
                h1 { font-size: 24px; margin: 0 0 0.5rem; }
                p { color: #999; margin: 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">${error ? '❌' : '✅'}</div>
                <h1>${error ? 'Authentication Failed' : 'Authentication Successful!'}</h1>
                <p>${error ? error : 'You can close this window and return to the terminal.'}</p>
              </div>
            </body>
          </html>
        `);
        
        // Close server and resolve/reject
        server.close();
        
        if (error) {
          reject(new Error(error));
        } else if (token) {
          resolve(token);
        } else {
          reject(new Error('No token received'));
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    server.listen(port, () => {
      // Server is ready
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Handle the login command
 */
export async function loginCommand(): Promise<void> {
  intro(pc.bgCyan(pc.black(' beetle auth login ')));
  
  // Check if already authenticated
  if (isAuthenticated()) {
    const config = getConfig();
    note(
      `You are already logged in as ${pc.cyan(config.email || 'Unknown')}.\n` +
      `Run ${pc.dim('beetle auth logout')} first to switch accounts.`,
      'Already Authenticated'
    );
    outro(pc.dim('No action taken.'));
    return;
  }
  
  const s = spinner();
  
  try {
    // Find available port
    s.start('Preparing authentication...');
    const port = await findAvailablePort();
    s.stop('Ready to authenticate');
    
    // Build auth URL
    const authUrl = `${BEETLE_WEB_URL}/sign-in?source=cli&port=${port}`;
    
    note(
      `Opening browser to authenticate...\n\n` +
      `If browser doesn't open, visit:\n${pc.dim(authUrl)}`,
      'Browser Authentication'
    );
    
    // Open browser
    await open(authUrl);
    
    // Wait for callback
    s.start('Waiting for authentication...');
    const token = await waitForAuthCallback(port);
    
    // Decode token to get user details
    const payload = decodeJwt(token);
    
    // Save auth
    saveAuth(token, {
      userId: payload?.userId as string,
      email: payload?.email as string,
      firstName: payload?.firstName as string,
      lastName: payload?.lastName as string,
      imageUrl: payload?.imageUrl as string,
    });
    
    s.stop('Authenticated successfully!');
    
    const email = (payload?.email as string) || 'Unknown';
    note(
      `Logged in as ${pc.cyan(email)}\n` +
      `Token saved to ${pc.dim(getConfigPath())}`,
      'Success'
    );
    
    outro(pc.green('✓ You are now authenticated!'));
    
  } catch (error) {
    s.stop('Authentication failed');
    
    if (isCancel(error)) {
      cancel('Authentication cancelled.');
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      note(pc.red(message), 'Error');
      outro(pc.red('✗ Authentication failed.'));
    }
    process.exit(1);
  }
}

/**
 * Handle the logout command
 */
export async function logoutCommand(): Promise<void> {
  intro(pc.bgCyan(pc.black(' beetle auth logout ')));
  
  if (!isAuthenticated()) {
    note('You are not currently logged in.', 'Not Authenticated');
    outro(pc.dim('No action taken.'));
    return;
  }
  
  const config = getConfig();
  const email = config.email || 'Unknown';
  
  clearAuth();
  
  note(
    `Logged out from ${pc.cyan(email)}\n` +
    `Token removed from ${pc.dim(getConfigPath())}`,
    'Logged Out'
  );
  
  outro(pc.green('✓ Successfully logged out.'));
}

/**
 * Handle the auth status command
 */
export async function statusCommand(): Promise<void> {
  intro(pc.bgCyan(pc.black(' beetle auth status ')));
  
  if (!isAuthenticated()) {
    note(
      `You are not logged in.\n\n` +
      `Run ${pc.cyan('beetle auth login')} to authenticate.`,
      'Not Authenticated'
    );
    outro(pc.dim('Status: logged out'));
    return;
  }
  
  const config = getConfig();
  
  const details = [
    `Email: ${pc.cyan(config.email || 'Unknown')}`,
    `Name: ${config.firstName || ''} ${config.lastName || ''}`.trim() || 'Not set',
    `Config: ${pc.dim(getConfigPath())}`,
  ].join('\n');
  
  note(details, 'Authenticated');
  outro(pc.green('✓ Status: logged in'));
}
