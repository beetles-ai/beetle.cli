import { isAuthenticated, getConfig } from './config.js';
import { note, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { execSync } from 'child_process';

/**
 * Check if user is authenticated, show error if not
 * @returns true if authenticated, false otherwise
 */
export function requireAuth(): boolean {
  if (!isAuthenticated()) {
    cancel(pc.red('Authentication required'));
    note(
      `You need to be logged in to use this command.\n\n` +
      `Run ${pc.cyan('beetle auth login')} to authenticate.`,
      'Not Authenticated'
    );
    return false;
  }
  return true;
}

/**
 * Check if we're in a git repository
 * @returns true if in git repo, false otherwise
 */
export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if we're in a git repo, show error if not
 * @returns true if in git repo, false otherwise
 */
export function requireGitRepo(): boolean {
  if (!isGitRepo()) {
    cancel(pc.red('Not a git repository'));
    note(
      `This command must be run inside a git repository.\n\n` +
      `Initialize with ${pc.cyan('git init')} or navigate to a git project.`,
      'Git Required'
    );
    return false;
  }
  return true;
}

/**
 * Get the current git repository name
 */
export function getRepoName(): string {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    // Extract repo name from URL (handles both SSH and HTTPS)
    const match = remoteUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
    
    // Fallback: use directory name
    return execSync('basename $(git rev-parse --show-toplevel)', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // Fallback: use current directory name
    return process.cwd().split('/').pop() || 'unknown';
  }
}

/**
 * Get the full repository path
 */
export function getRepoPath(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Get the current git branch name
 */
export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get the default branch (main/master)
 */
export function getDefaultBranch(): string {
  try {
    // Try to get from remote
    const remote = execSync('git remote show origin 2>/dev/null | grep "HEAD branch" | sed "s/.*: //"', {
      encoding: 'utf-8',
      shell: '/bin/bash',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    if (remote) return remote;
    
    // Fallback: check if main or master exists
    try {
      execSync('git rev-parse --verify main', { stdio: 'pipe' });
      return 'main';
    } catch {
      return 'master';
    }
  } catch {
    return 'main';
  }
}

/**
 * Get the authenticated user info
 */
export function getAuthUser(): { email: string; name: string } {
  const config = getConfig();
  return {
    email: config.email || 'Unknown',
    name: `${config.firstName || ''} ${config.lastName || ''}`.trim() || 'Unknown'
  };
}
