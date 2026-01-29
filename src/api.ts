import { gzipSync } from 'zlib';
import { getAuthToken } from './config.js';
import { getRepoPath, getCurrentBranch, getDefaultBranch } from './guards.js';
import { getChangedFiles, ChangedFile } from './git.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// API base URL - use environment variable or default to production
const API_BASE_URL = process.env.BEETLE_API_URL || 'https://api.beetleai.dev';
export interface ReviewComment {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  severity: string;
  confidence: string;
  title: string;
  content: string;
  created_at: string;
}

export interface ReviewResponse {
  message: string;
  extension_data_id: string;
  comments: ReviewComment[];
}

export interface AnalysisStatus {
  analysis_status: 'running' | 'completed' | 'failed' | 'interrupted';
  data_id: string;
}

/**
 * Compress large content using gzip and encode as base64
 */
function compressContent(content: string): string {
  const buffer = Buffer.from(content, 'utf-8');
  const compressed = gzipSync(buffer);
  return compressed.toString('base64');
}

/**
 * Get file content
 */
function getFileContent(filePath: string): string {
  try {
    const repoPath = getRepoPath();
    return fs.readFileSync(path.join(repoPath, filePath), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Get diff for a file
 */
function getFileDiff(filePath: string, isUntracked: boolean): string {
  try {
    const repoPath = getRepoPath();
    if (isUntracked) {
      // For untracked files, return full content
      return getFileContent(filePath);
    }
    return execSync(`git diff HEAD -- "${filePath}"`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return '';
  }
}

/**
 * Get full diff (staged + unstaged)
 */
function getFullDiff(): string {
  try {
    const repoPath = getRepoPath();
    const staged = execSync('git diff --cached', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const unstaged = execSync('git diff', {
      cwd: repoPath,
      encoding: 'utf-8', 
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return (staged || '') + (unstaged || '');
  } catch {
    return 'No diff available';
  }
}

/**
 * Get remote URL for the repository
 */
function getRemoteUrl(): string {
  try {
    const repoPath = getRepoPath();
    const url = execSync('git config --get remote.origin.url', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    // Convert SSH to HTTPS
    if (url.startsWith('git@')) {
      return url.replace(':', '/').replace('git@', 'https://').replace('.git', '');
    }
    return url.replace('.git', '');
  } catch {
    return getRepoPath();
  }
}

/**
 * Get repository name from path
 */
function getRepoName(): string {
  return path.basename(getRepoPath());
}

/**
 * Get current commit SHA
 */
function getCommitSha(): string {
  try {
    const repoPath = getRepoPath();
    return execSync('git rev-parse HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Build the review payload with compression
 */
export function buildReviewPayload(files: ChangedFile[]): any {
  const repoPath = getRepoPath();
  const repoName = getRepoName();
  const currentBranch = getCurrentBranch();
  const defaultBranch = getDefaultBranch();
  const commitSha = getCommitSha();
  const remoteUrl = getRemoteUrl();
  
  // Size threshold for compression (10KB)
  const COMPRESSION_THRESHOLD = 10 * 1024;
  
  // Build files array with compression for large patches
  const filesPayload = files.map(file => {
    const isUntracked = file.status === 'untracked' || file.status === 'added';
    const patch = getFileDiff(file.path, isUntracked);
    const content = getFileContent(file.path);
    
    const fileData: any = {
      filename: file.path,
      status: file.status === 'untracked' ? 'added' : file.status,
      additions: file.additions,
      deletions: file.deletions,
    };
    
    // Compress large patches
    if (patch.length > COMPRESSION_THRESHOLD) {
      fileData.patch_compressed = compressContent(patch);
      fileData._compressed = true;
    } else {
      fileData.patch = patch;
    }
    
    // Compress large content
    if (content.length > COMPRESSION_THRESHOLD) {
      fileData.content_compressed = compressContent(content);
      fileData._compressed = true;
    } else {
      fileData.content = content;
    }
    
    return fileData;
  });
  
  // Calculate totals
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  
  return {
    repository: {
      name: repoName,
      fullName: repoName,
      owner: 'local',
      url: remoteUrl
    },
    branches: {
      head: {
        ref: currentBranch,
        sha: commitSha
      },
      base: {
        ref: defaultBranch,
        sha: ''
      }
    },
    changes: {
      summary: {
        files: files.length,
        additions: totalAdditions,
        deletions: totalDeletions
      },
      commits: [],
      files: filesPayload,
      fullDiff: getFullDiff() || 'No changes'
    },
    analysis_type: 'cli_analysis'
  };
}

/**
 * Submit a review request to the API
 */
export async function submitReview(files: ChangedFile[]): Promise<ReviewResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const payload = buildReviewPayload(files);
  
  const response = await fetch(`${API_BASE_URL}/api/extension/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

/**
 * Poll for new comments
 */
export async function pollComments(dataId: string): Promise<ReviewComment[]> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const response = await fetch(`${API_BASE_URL}/api/extension/comments/${dataId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to poll comments: ${response.status}`);
  }
  
  const data = await response.json();
  return data.comments || [];
}

/**
 * Get analysis status
 */
export async function getAnalysisStatus(dataId: string): Promise<AnalysisStatus> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const response = await fetch(`${API_BASE_URL}/api/extension/status/${dataId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get status: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Stop an ongoing analysis
 */
export async function stopAnalysis(dataId: string): Promise<void> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const response = await fetch(`${API_BASE_URL}/api/extension/stop/${dataId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to stop analysis: ${response.status}`);
  }
}
