import pc from 'picocolors';
import gradient from 'gradient-string';
import readline from 'readline';
import { ReviewComment } from './api.js';

// BEETLE gradient
const beetleGradient = gradient(['#5ea58e', '#6bb85f', '#64b394', '#a5ce59', '#dfc48f']);

export interface FileComments {
  filePath: string;
  comments: ReviewComment[];
  expanded: boolean;
}

export interface ReviewState {
  files: FileComments[];
  totalComments: number;
  resolvedComments: number;
  selectedFileIndex: number;
  selectedCommentIndex: number;
  showingDetail: boolean;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
}

/**
 * Parse comment content to extract metadata
 */
export function parseComment(content: string): {
  title: string;
  severity: string;
  description: string;
  codeBlock: string;
  aiPrompt: string;
} {
  const titleMatch = content.match(/\*\*Title\*\*:\s*([^\n]+)/);
  const severityMatch = content.match(/\*\*Severity\*\*:\s*(\w+)/);
  
  // Extract description (text after metadata, before code blocks)
  let description = content
    .replace(/\*\*File\*\*:\s*`[^`]+`\n?/g, '')
    .replace(/\*\*Line_Start\*\*:\s*\d+\n?/g, '')
    .replace(/\*\*Line_End\*\*:\s*\d+\n?/g, '')
    .replace(/\*\*Severity\*\*:\s*\w+\n?/g, '')
    .replace(/\*\*Confidence\*\*:\s*[^\n]+\n?/g, '')
    .replace(/\*\*Title\*\*:\s*[^\n]+\n?/g, '')
    .trim();
  
  // Extract code blocks from <details> sections
  let codeBlock = '';
  const detailsMatch = content.match(/<details>[\s\S]*?<\/details>/gi);
  if (detailsMatch) {
    codeBlock = detailsMatch.join('\n');
  }
  
  // Extract AI prompt
  let aiPrompt = '';
  const promptMatch = content.match(/\*\*Prompt (?:for|to) (?:Fix with )?AI[^*]*\*\*:?\s*([\s\S]*?)(?:\n\n##|\n\n\*\*|$)/i);
  if (promptMatch) {
    aiPrompt = promptMatch[1].trim();
  }
  
  // Clean description of code blocks
  description = description.replace(/<details>[\s\S]*?<\/details>/gi, '').trim();
  
  return {
    title: titleMatch?.[1] || 'Untitled',
    severity: severityMatch?.[1] || 'Medium',
    description: description.split('\n')[0].substring(0, 200), // First line, truncated
    codeBlock,
    aiPrompt
  };
}

/**
 * Get severity color
 */
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return pc.red;
    case 'high':
      return pc.magenta;
    case 'medium':
      return pc.yellow;
    case 'low':
      return pc.blue;
    default:
      return pc.dim;
  }
}

/**
 * Get severity badge
 */
function getSeverityBadge(severity: string): string {
  const color = getSeverityColor(severity);
  switch (severity.toLowerCase()) {
    case 'critical':
      return color('[C]');
    case 'high':
      return color('[H]');
    case 'medium':
      return color('[M]');
    case 'low':
      return color('[L]');
    default:
      return color('[P]');
  }
}

/**
 * Get terminal dimensions
 */
function getTerminalSize(): { width: number; height: number } {
  return {
    width: process.stdout.columns || 120,
    height: process.stdout.rows || 40
  };
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Truncate string to fit width
 */
function truncate(str: string, maxWidth: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxWidth) return str;
  return str.substring(0, maxWidth - 3) + '...';
}

/**
 * Word wrap text
 */
function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    if (stripAnsi(currentLine + ' ' + word).length > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  return lines;
}

/**
 * Render the file tree (left panel)
 */
function renderFileTree(state: ReviewState, width: number, height: number): string[] {
  const lines: string[] = [];
  
  // Header
  lines.push(pc.bold('Filter: ') + pc.dim('Press / to filter files'));
  lines.push(pc.dim('─'.repeat(width)));
  
  // Summary
  const resolvedText = `${state.resolvedComments} of ${state.totalComments} comments resolved`;
  lines.push(`Files / Comments ${resolvedText}`);
  
  // File list
  let globalCommentIndex = 0;
  state.files.forEach((file, fileIndex) => {
    const isFileSelected = fileIndex === state.selectedFileIndex && !state.showingDetail;
    const issueCount = file.comments.length;
    const issueText = issueCount === 1 ? '1 Potential Issue' : `${issueCount} Potential Issues`;
    
    // File header
    const expandIcon = file.expanded ? '▼' : '▶';
    const filePrefix = isFileSelected ? pc.cyan('›') : ' ';
    const fileName = truncate(file.filePath, width - 25);
    lines.push(`${filePrefix} ${expandIcon} ${pc.dim(fileName)} ${pc.yellow(`(${issueText})`)}`);
    
    // Comments under file (if expanded)
    if (file.expanded) {
      file.comments.forEach((comment, commentIndex) => {
        const parsed = parseComment(comment.content);
        const isCommentSelected = fileIndex === state.selectedFileIndex && 
                                   commentIndex === state.selectedCommentIndex &&
                                   state.showingDetail;
        
        const badge = getSeverityBadge(parsed.severity);
        const prefix = isCommentSelected ? pc.cyan('  ›') : '   ';
        const title = truncate(parsed.title, width - 15);
        
        lines.push(`${prefix} ${badge} ${title}`);
        globalCommentIndex++;
      });
    }
  });
  
  // Pad to fill height
  while (lines.length < height - 2) {
    lines.push('');
  }
  
  return lines;
}

/**
 * Render comment detail (right panel)
 */
function renderCommentDetail(state: ReviewState, width: number, height: number): string[] {
  const lines: string[] = [];
  const selectedFile = state.files[state.selectedFileIndex];
  
  if (!selectedFile || selectedFile.comments.length === 0) {
    lines.push(pc.dim('No comment selected'));
    return lines;
  }
  
  const comment = selectedFile.comments[state.selectedCommentIndex] || selectedFile.comments[0];
  const parsed = parseComment(comment.content);
  
  // Header
  lines.push(`File: ${pc.cyan(selectedFile.filePath)}`);
  lines.push(`Comment on line ${pc.yellow(String(comment.line_start))}`);
  lines.push(pc.dim('─'.repeat(width)));
  lines.push('');
  
  // Title with severity color
  const severityColor = getSeverityColor(parsed.severity);
  lines.push(severityColor(pc.bold(parsed.title)));
  lines.push('');
  
  // Description (word wrapped)
  const descLines = wordWrap(parsed.description, width - 4);
  descLines.forEach(line => lines.push(line));
  lines.push('');
  
  // Code block if present
  if (parsed.codeBlock) {
    // Parse details/summary
    const summaryMatch = parsed.codeBlock.match(/<summary>(.*?)<\/summary>/);
    if (summaryMatch) {
      lines.push(pc.dim('<details>'));
      lines.push(`  ${pc.yellow(`<summary>● ${summaryMatch[1]}</summary>`)}`);
    }
    
    // Extract code changes
    const codeContent = parsed.codeBlock
      .replace(/<details>/gi, '')
      .replace(/<\/details>/gi, '')
      .replace(/<summary>.*?<\/summary>/gi, '')
      .trim();
    
    // Format code lines with diff highlighting
    const codeLines = codeContent.split('\n').slice(0, 15); // Limit lines
    codeLines.forEach(line => {
      if (line.startsWith('+')) {
        lines.push(pc.green('    ' + line));
      } else if (line.startsWith('-')) {
        lines.push(pc.red('    ' + line));
      } else {
        lines.push(pc.dim('    ' + line));
      }
    });
    
    lines.push(pc.dim('</details>'));
    lines.push('');
  }
  
  // AI Prompt section
  if (parsed.aiPrompt) {
    lines.push(pc.bold(pc.yellow('Prompt to Fix with AI ✨:')));
    lines.push('');
    const promptLines = wordWrap(parsed.aiPrompt, width - 4);
    promptLines.slice(0, 6).forEach(line => lines.push(line));
    if (promptLines.length > 6) {
      lines.push(pc.dim('...'));
    }
  }
  
  // Pad to fill height
  while (lines.length < height - 2) {
    lines.push('');
  }
  
  return lines;
}

/**
 * Render status bar
 */
function renderStatusBar(state: ReviewState, width: number): string {
  const controls = [
    `${pc.dim('↑↓: Scroll Details')}`,
    `${pc.dim('Esc/←: Close Details')}`,
    `${pc.dim('c: Copy Prompt to Fix with AI')}`,
    `${pc.dim('a: Apply suggestion')}`,
  ];
  
  const controlsLine = controls.join('  |  ');
  const rejectLine = `${pc.dim('r: Reject comment')}`;
  
  return `${controlsLine}\n${rejectLine}`;
}

/**
 * Render the full review UI
 */
export function renderReviewUI(state: ReviewState): void {
  const { width, height } = getTerminalSize();
  
  console.clear();
  
  // Calculate panel widths
  const leftWidth = Math.floor(width * 0.35);
  const rightWidth = width - leftWidth - 3; // 3 for separator
  const contentHeight = height - 4; // Room for status bar
  
  // Render panels
  const leftPanel = renderFileTree(state, leftWidth, contentHeight);
  const rightPanel = renderCommentDetail(state, rightWidth, contentHeight);
  
  // Combine panels side by side
  for (let i = 0; i < Math.max(leftPanel.length, rightPanel.length); i++) {
    const left = (leftPanel[i] || '').padEnd(leftWidth);
    const right = rightPanel[i] || '';
    console.log(`${left} ${pc.dim('│')} ${right}`);
  }
  
  // Status bar
  console.log(pc.dim('─'.repeat(width)));
  console.log(renderStatusBar(state, width));
}

/**
 * Group comments by file
 */
export function groupCommentsByFile(comments: ReviewComment[]): FileComments[] {
  const fileMap = new Map<string, ReviewComment[]>();
  
  comments.forEach(comment => {
    const existing = fileMap.get(comment.file_path) || [];
    existing.push(comment);
    fileMap.set(comment.file_path, existing);
  });
  
  return Array.from(fileMap.entries()).map(([filePath, comments]) => ({
    filePath,
    comments,
    expanded: true // Start expanded
  }));
}

/**
 * Create initial review state
 */
export function createReviewState(comments: ReviewComment[]): ReviewState {
  const files = groupCommentsByFile(comments);
  return {
    files,
    totalComments: comments.length,
    resolvedComments: 0,
    selectedFileIndex: 0,
    selectedCommentIndex: 0,
    showingDetail: files.length > 0,
    status: 'running'
  };
}

/**
 * Add comments to existing state
 */
export function addCommentsToState(state: ReviewState, newComments: ReviewComment[]): ReviewState {
  newComments.forEach(comment => {
    // Find or create file group
    let fileGroup = state.files.find(f => f.filePath === comment.file_path);
    if (!fileGroup) {
      fileGroup = {
        filePath: comment.file_path,
        comments: [],
        expanded: true
      };
      state.files.push(fileGroup);
    }
    
    // Add comment if not duplicate
    const exists = fileGroup.comments.some(c => 
      c.line_start === comment.line_start && c.title === comment.title
    );
    if (!exists) {
      fileGroup.comments.push(comment);
      state.totalComments++;
    }
  });
  
  return state;
}

/**
 * Handle keyboard navigation
 */
export function handleKeypress(
  state: ReviewState, 
  key: readline.Key,
  callbacks: {
    onCopyPrompt: (prompt: string) => void;
    onQuit: () => void;
    onRefresh: () => void;
  }
): ReviewState {
  const { name, ctrl } = key;
  
  // Quit
  if (name === 'q' || (ctrl && name === 'c')) {
    callbacks.onQuit();
    return state;
  }
  
  // Navigation
  if (name === 'up' || name === 'k') {
    if (state.showingDetail && state.selectedCommentIndex > 0) {
      state.selectedCommentIndex--;
    } else if (state.selectedFileIndex > 0) {
      state.selectedFileIndex--;
      const file = state.files[state.selectedFileIndex];
      state.selectedCommentIndex = file ? file.comments.length - 1 : 0;
    }
  }
  
  if (name === 'down' || name === 'j') {
    const currentFile = state.files[state.selectedFileIndex];
    if (state.showingDetail && currentFile && 
        state.selectedCommentIndex < currentFile.comments.length - 1) {
      state.selectedCommentIndex++;
    } else if (state.selectedFileIndex < state.files.length - 1) {
      state.selectedFileIndex++;
      state.selectedCommentIndex = 0;
    }
  }
  
  // Enter to show detail / toggle expand
  if (name === 'return') {
    const file = state.files[state.selectedFileIndex];
    if (file) {
      if (!state.showingDetail) {
        file.expanded = !file.expanded;
      }
      state.showingDetail = true;
    }
  }
  
  // Escape or left to go back
  if (name === 'escape' || name === 'left') {
    state.showingDetail = false;
  }
  
  // Right to enter detail
  if (name === 'right') {
    state.showingDetail = true;
  }
  
  // Copy AI prompt
  if (name === 'c') {
    const file = state.files[state.selectedFileIndex];
    if (file && file.comments[state.selectedCommentIndex]) {
      const comment = file.comments[state.selectedCommentIndex];
      const parsed = parseComment(comment.content);
      if (parsed.aiPrompt) {
        callbacks.onCopyPrompt(parsed.aiPrompt);
      }
    }
  }
  
  // Refresh
  if (name === 'r' && ctrl) {
    callbacks.onRefresh();
  }
  
  // Toggle file expansion with tab
  if (name === 'tab') {
    const file = state.files[state.selectedFileIndex];
    if (file) {
      file.expanded = !file.expanded;
    }
  }
  
  return state;
}
