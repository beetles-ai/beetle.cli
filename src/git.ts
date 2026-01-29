import { execSync } from 'child_process';
import { getRepoPath } from './guards.js';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
  additions: number;
  deletions: number;
  staged: boolean;
}

export interface GitChanges {
  files: ChangedFile[];
  totalFiles: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Get all changed files (staged + unstaged + untracked)
 */
export function getChangedFiles(options: { stagedOnly?: boolean } = {}): GitChanges {
  const cwd = getRepoPath();
  const files: ChangedFile[] = [];
  
  try {
    // Get staged changes with stats
    const stagedOutput = execSync('git diff --cached --numstat', { 
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    if (stagedOutput) {
      stagedOutput.split('\n').forEach(line => {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
          const filePath = parts[2];
          
          files.push({
            path: filePath,
            status: 'modified',
            additions,
            deletions,
            staged: true
          });
        }
      });
    }
    
    if (!options.stagedOnly) {
      // Get unstaged changes with stats
      const unstagedOutput = execSync('git diff --numstat', { 
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      
      if (unstagedOutput) {
        unstagedOutput.split('\n').forEach(line => {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
            const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
            const filePath = parts[2];
            
            // Check if already in list (from staged)
            const existing = files.find(f => f.path === filePath);
            if (existing) {
              existing.additions += additions;
              existing.deletions += deletions;
            } else {
              files.push({
                path: filePath,
                status: 'modified',
                additions,
                deletions,
                staged: false
              });
            }
          }
        });
      }
      
      // Get untracked files
      const untrackedOutput = execSync('git ls-files --others --exclude-standard', { 
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      
      if (untrackedOutput) {
        untrackedOutput.split('\n').forEach(filePath => {
          if (filePath) {
            // Count lines in file for additions
            let additions = 0;
            try {
              const content = execSync(`wc -l < "${filePath}"`, {
                encoding: 'utf-8',
                cwd,
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim();
              additions = parseInt(content, 10) || 0;
            } catch {
              additions = 0;
            }
            
            files.push({
              path: filePath,
              status: 'untracked',
              additions,
              deletions: 0,
              staged: false
            });
          }
        });
      }
    }
    
    // Get status to determine added/deleted
    const statusOutput = execSync('git status --porcelain', { 
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    if (statusOutput) {
      statusOutput.split('\n').forEach(line => {
        const status = line.substring(0, 2);
        const filePath = line.substring(3).trim();
        
        const file = files.find(f => f.path === filePath);
        if (file) {
          if (status.includes('A')) {
            file.status = 'added';
          } else if (status.includes('D')) {
            file.status = 'deleted';
          } else if (status === '??') {
            file.status = 'untracked';
          }
        }
      });
    }
    
  } catch (error) {
    // Return empty on error
  }
  
  // Calculate totals
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  
  files.forEach(f => {
    if (f.status === 'added' || f.status === 'untracked') addedCount++;
    else if (f.status === 'modified') modifiedCount++;
    else if (f.status === 'deleted') deletedCount++;
    
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  });
  
  return {
    files,
    totalFiles: files.length,
    addedCount,
    modifiedCount,
    deletedCount,
    totalAdditions,
    totalDeletions
  };
}
