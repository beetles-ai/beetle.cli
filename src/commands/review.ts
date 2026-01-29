import gradient from 'gradient-string';
import pc from 'picocolors';
import readline from 'readline';
import path from 'path';
import { execSync } from 'child_process';
import { 
  requireAuth, 
  requireGitRepo, 
  getRepoPath, 
  getCurrentBranch, 
  getDefaultBranch,
  getAuthUser 
} from '../guards.js';
import { getChangedFiles, GitChanges } from '../git.js';
import { submitReview, pollComments, getAnalysisStatus, stopAnalysis, ReviewComment } from '../api.js';

// BEETLE gradient
const beetleGradient = gradient(['#5ea58e', '#6bb85f', '#64b394', '#a5ce59', '#dfc48f']);

// ASCII art for BEETLE
const BEETLE_ASCII = `
██████╗ ███████╗███████╗████████╗██╗     ███████╗
██╔══██╗██╔════╝██╔════╝╚══██╔══╝██║     ██╔════╝
██████╔╝█████╗  █████╗     ██║   ██║     █████╗  
██╔══██╗██╔══╝  ██╔══╝     ██║   ██║     ██╔══╝  
██████╔╝███████╗███████╗   ██║   ███████╗███████╗
╚═════╝ ╚══════╝╚══════╝   ╚═╝   ╚══════╝╚══════╝
`;

// Fun loading messages
const LOADING_MESSAGES = [
  'Calibrating sarcasm levels...',
  'Teaching bugs to fly...',
  'Analyzing code patterns...',
  'Consulting the code oracle...',
  'Hunting for edge cases...',
];

// Polling interval (30 seconds)
const POLL_INTERVAL = 30000;

// ==============================================================
// Types
// ==============================================================

interface FileGroup {
  filePath: string;
  comments: ReviewComment[];
  expanded: boolean;
}

interface ReviewState {
  dataId?: string;
  mode: 'list' | 'detail';  // list = file tree, detail = split view
  focusedPanel: 'left' | 'right'; // which panel has focus in detail mode
  files: FileGroup[];
  selectedFileIndex: number;
  selectedCommentIndex: number;
  detailScrollOffset: number;
  leftPanelScrollOffset: number; // scroll offset for left panel in detail mode
  totalComments: number;
  resolvedComments: number;
  status: 'running' | 'completed' | 'failed';
  spinnerFrame: number;
}

async function runPromptOnlyMode(changes: GitChanges): Promise<void> {
  let currentDataId: string | undefined;
  let spinnerInterval: NodeJS.Timeout | null = null;
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;

  const startSpinner = () => {
    if (spinnerInterval) return;
    spinnerInterval = setInterval(() => {
      process.stdout.write(`\r${pc.cyan(spinnerFrames[frame++ % spinnerFrames.length])} Analysis in progress...`);
    }, 80);
  };

  const stopSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write('\r\x1B[K'); // clear line
    }
  };
  
  const cleanup = async (code: number = 0) => {
    stopSpinner();
    if (currentDataId) {
       await stopAnalysis(currentDataId).catch(() => {});
    }
    if (code === 0) console.log(pc.green('\n  ✓ Review session ended.\n'));
    process.exit(code);
  };

  process.on('SIGINT', async () => await cleanup(0));

  try {
    console.log(pc.yellow('  → Submitting review...'));
    const response = await submitReview(changes.files);
    const dataId = response.extension_data_id;
    currentDataId = dataId;
    
    console.log(pc.green('  ✓ Review started. Streaming AI prompts...\n'));
    startSpinner();
    
    // Track processed comments to avoid duplicates
    const processedCommentIds = new Set<string>();
    
    // Poll loop
    let status = 'running';
    while (status === 'running') {
      const comments = await pollComments(dataId);
      
      let gotNew = false;
      // Process new comments
      comments.forEach(c => {
        if (!processedCommentIds.has(c.id)) {
          processedCommentIds.add(c.id);
          const { aiPrompt, title } = parseCommentMetadata(c.content);
          
          if (aiPrompt) {
            gotNew = true;
            stopSpinner();
            console.log(pc.bold(pc.cyan(`\n● ${title || 'Issue'}`)));
            console.log(pc.dim('─'.repeat(40)));
            console.log(aiPrompt.trim());
            console.log('');
          }
        }
      });
      
      if (gotNew) startSpinner();
      
      const analysis = await getAnalysisStatus(dataId);
      status = analysis.analysis_status;
      
      if (status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    stopSpinner();
    if (status === 'failed') {
      console.log(pc.red('\n✗ Analysis failed.'));
      process.exit(1);
    } else {
      console.log(pc.green('\n✓ Analysis complete.'));
      process.exit(0);
    }
    
  } catch (error: any) {
    stopSpinner();
    console.log(pc.red(`\n✗ Error: ${error.message}`));
    process.exit(1);
  }
}

// ==============================================================
// Terminal Utilities
// ==============================================================

function getTerminalSize(): { width: number; height: number } {
  return {
    width: process.stdout.columns || 120,
    height: process.stdout.rows || 40
  };
}

function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[H');
}

function enterAlternateScreen(): void {
  process.stdout.write('\x1B[?1049h');
  process.stdout.write('\x1B[?25l');
}

function exitAlternateScreen(): void {
  process.stdout.write('\x1B[?25h');
  process.stdout.write('\x1B[?1049l');
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

// Pad string to a target width accounting for ANSI codes
function padAnsi(str: string, width: number): string {
  const visible = stripAnsi(str).length;
  const pad = Math.max(0, width - visible);
  return str + ' '.repeat(pad);
}

function centerText(text: string, width: number): string {
  const lines = text.split('\n');
  return lines.map(line => {
    const padding = Math.max(0, Math.floor((width - stripAnsi(line).length) / 2));
    return ' '.repeat(padding) + line;
  }).join('\n');
}

function truncate(str: string, maxLen: number): string {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen <= maxLen) return str;
  
  // Truncate properly accounting for ANSI codes
  let result = '';
  let visibleCount = 0;
  let inAnsi = false;
  let ansiStart = -1;
  
  for (let i = 0; i < str.length && visibleCount < maxLen - 3; i++) {
    const char = str[i];
    if (char === '\x1B') {
      inAnsi = true;
      ansiStart = i;
      result += char;
    } else if (inAnsi) {
      result += char;
      if (char === 'm') {
        inAnsi = false;
        ansiStart = -1;
      }
    } else {
      result += char;
      visibleCount++;
    }
  }
  
  // If we're in the middle of an ANSI sequence, close it
  if (inAnsi && ansiStart >= 0) {
    // Remove incomplete ANSI sequence
    result = result.substring(0, ansiStart);
    visibleCount = stripAnsi(result).length;
    // Re-truncate if needed
    if (visibleCount > maxLen - 3) {
      result = result.substring(0, result.length - (visibleCount - (maxLen - 3)));
    }
  }
  
  return result + '...';
}

function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testLength = stripAnsi(testLine).length;
    
    if (testLength > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word itself is too long, truncate it
        const truncated = truncate(word, maxWidth);
        lines.push(truncated);
        currentLine = '';
      }
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Truncate a line to fit within maxWidth, preserving ANSI codes
function truncateLine(str: string, maxWidth: number): string {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen <= maxWidth) return str;
  return truncate(str, maxWidth);
}

/**
 * Format markdown text for terminal display
 */
function formatMarkdown(text: string, maxWidth: number): string[] {
  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/);
  const result: string[] = [];
  
  paragraphs.forEach(para => {
    // Remove markdown formatting but preserve structure
    let formatted = para
      .replace(/\*\*(.*?)\*\*/g, pc.bold('$1')) // Bold
      .replace(/\*(.*?)\*/g, pc.italic('$1')) // Italic
      .replace(/`([^`]+)`/g, (match, code) => pc.cyan(code)) // Inline code
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links
      .trim();
    
    // Word wrap the paragraph
    const wrapped = wordWrap(formatted, maxWidth);
    result.push(...wrapped);
    result.push(''); // Empty line between paragraphs
  });
  
  // Remove trailing empty line
  if (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  
  return result;
}

// ==============================================================
// Comment Parsing
// ==============================================================

function parseCommentMetadata(content: string): {
  title: string;
  severity: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  codeBlock: string;
  aiPrompt: string;
} {
  // 1. Extract Metadata
  const severityMatch = content.match(/\*\*Severity\*\*:\s*(\w+)/i);
  const lineStartMatch = content.match(/\*\*Line_Start\*\*:\s*(\d+)/i);
  const lineEndMatch = content.match(/\*\*Line_End\*\*:\s*(\d+)/i);
  const titleMatch = content.match(/\*\*Title\*\*:\s*([^\n]+)/i);

  // 2. Extract "Suggested Fix" (Code Block)
  let codeBlock = '';
  // Look for details with summary "Suggested Fix"
  const fixMatch = content.match(/<details>\s*<summary>\s*Suggested Fix\s*<\/summary>([\s\S]*?)<\/details>/i);
  if (fixMatch) {
    codeBlock = fixMatch[1].trim();
  } else {
    // Fallback: look for generic code blocks if not in structured format (and not part of AI prompt)
    // We try to avoid capturing the AI prompt code block here by checking context if possible, 
    // but simple regex is trickier. For now, rely on specific structure if present.
    const genericMatches = content.match(/```[\s\S]*?```/g);
    if (genericMatches && genericMatches.length > 0) {
        // If we have "Suggested Fix" wrapper, we used it. If not, maybe the first code block is relevant code?
        // But in the new format, Suggested Fix is always wrapped.
    }
  }

  // 3. Extract "Prompt for AI"
  let aiPrompt = '';
  const aiPromptMatch = content.match(/<details>\s*<summary>\s*Prompt for AI\s*<\/summary>([\s\S]*?)<\/details>/i);
  if (aiPromptMatch) {
    const inner = aiPromptMatch[1];
    // The prompt is often in a code block for easy copying
    const innerCodeBlock = inner.match(/```(?:suggestion)?\s*([\s\S]*?)```/);
    if (innerCodeBlock) {
        aiPrompt = innerCodeBlock[1].trim();
    } else {
        // Fallback: remove the "Copy this..." header and take the rest
        aiPrompt = inner.replace(/\*\*Copy this prompt.*?\*\*[\s\S]*?:/i, '').trim();
    }
  } else {
     // Backward compatibility for other formats
     const oldPromptMatch = content.match(/\*\*Prompt (?:for|to) (?:Fix with )?AI[^*]*\*\*:?\s*([\s\S]*?)(?:\n\n##|\n\n\*\*|$)/i);
     if (oldPromptMatch) aiPrompt = oldPromptMatch[1].trim();
  }

  // 4. Extract Description (The primary text)
  let description = content
    .replace(/\[PR_COMMENT_START\]/g, '')
    .replace(/\[PR_COMMENT_END\]/g, '')
    .replace(/\*\*File\*\*:[^\n]*\n?/gi, '')
    .replace(/\*\*Line_Start\*\*:[^\n]*\n?/gi, '')
    .replace(/\*\*Line_End\*\*:[^\n]*\n?/gi, '')
    .replace(/\*\*Severity\*\*:[^\n]*\n?/gi, '')
    .replace(/\*\*Confidence\*\*:[^\n]*\n?/gi, '')
    .replace(/\*\*Title\*\*:[^\n]*\n?/gi, '')
    // Remove all detail blocks (Suggested Fix, Prompt for AI, etc.)
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .trim();

  // Determine Title (use explicit or derive from description)
  let title = titleMatch?.[1] || '';
  if (!title && description) {
      // Use first non-empty line as title, truncate if needed
      const firstLine = description.split('\n').find(l => l.trim().length > 0) || '';
      title = firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
  }
  if (!title) title = 'Issue Identified';

  return {
    title,
    severity: severityMatch?.[1] || 'Medium',
    lineStart: parseInt(lineStartMatch?.[1] || '0'),
    lineEnd: parseInt(lineEndMatch?.[1] || '0'),
    description,
    codeBlock,
    aiPrompt
  };
}
  
  function getSeverityBadge(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical': return pc.red('[C]');
      case 'high': return pc.yellow('[H]');
      case 'medium': return pc.blue('[M]');
      case 'low': return pc.dim('[L]');
      default: return pc.dim('[P]');
    }
  }
  
  function getSeverityColor(severity: string): (s: string) => string {
    switch (severity.toLowerCase()) {
      case 'critical': return pc.red;
      case 'high': return pc.yellow;
      case 'medium': return pc.blue;
      default: return pc.dim;
    }
  }
  
  // ==============================================================
  // Rendering Functions
  // ==============================================================

function drawScrollbar(lines: string[], contentHeight: number, totalLines: number, scrollOffset: number): string[] {
  if (totalLines <= contentHeight) return lines;
  
  const scrollbarHeight = Math.max(1, Math.floor((contentHeight / totalLines) * contentHeight));
  const scrollbarStart = Math.floor((scrollOffset / totalLines) * contentHeight);
  
  return lines.map((line, i) => {
    // Only add scrollbar within the content height
    if (i >= contentHeight) return line;
    
    const isScrollThumb = i >= scrollbarStart && i < scrollbarStart + scrollbarHeight;
    const marker = isScrollThumb ? '█' : '│';
    // Append to the end of the line (assuming line is already padded/truncated to width-1)
    return line + pc.dim(marker);
  });
}

  function renderFileList(state: ReviewState, width: number, maxHeight: number, scrollOffset: number = 0): { lines: string[]; totalLines: number } {
    const lines: string[] = [];
    
    // Header (only if not scrolled)
    if (scrollOffset === 0) {
      lines.push(pc.bold('Filter: ') + pc.dim('Press / to filter files'));
      lines.push(pc.dim('─'.repeat(width)));
      
      // Summary
      const statusIcon = state.status === 'running' ? pc.yellow('⟳') : 
                         state.status === 'completed' ? pc.green('✓') : pc.red('✗');
      lines.push(`Files / Comments ${state.resolvedComments} of ${state.totalComments} comments resolved ${statusIcon}`);
      lines.push(''); // Empty line after header
    }
    
    // Build flat list of navigable items
    state.files.forEach((file, fIdx) => {
      const isFileSelected = fIdx === state.selectedFileIndex && state.selectedCommentIndex === -1;
      const prefix = isFileSelected ? pc.cyan('›') : ' ';
      const expandIcon = file.expanded ? '▼' : '▶';
      
      // Count by severity
      const counts: string[] = [];
      let critical = 0, high = 0, medium = 0;
      file.comments.forEach(c => {
        const { severity } = parseCommentMetadata(c.content);
        if (severity.toLowerCase() === 'critical') critical++;
        else if (severity.toLowerCase() === 'high') high++;
        else medium++;
      });
      if (critical > 0) counts.push(pc.red(String(critical)));
      if (high > 0) counts.push(pc.yellow(String(high)));
      if (medium > 0) counts.push(pc.blue(String(medium)));
      
      // Calculate available width for file name (accounting for prefix, icon, and counts)
      const prefixLen = stripAnsi(prefix).length;
      const iconLen = 2; // ▼ or ▶ + space
      const countStr = counts.length > 0 ? `  ${counts.join(', ')}` : '';
      const countLen = stripAnsi(countStr).length;
      const availableWidth = width - prefixLen - iconLen - countLen;
      
      const fileName = truncate(file.filePath, Math.max(10, availableWidth));
      lines.push(`${prefix} ${expandIcon} ${fileName}${countStr}`);
      
      // Comments
      if (file.expanded) {
        file.comments.forEach((comment, cIdx) => {
          const isCommentSelected = fIdx === state.selectedFileIndex && cIdx === state.selectedCommentIndex;
          const cPrefix = isCommentSelected ? pc.cyan('    ›') : '     ';
          const { title, severity } = parseCommentMetadata(comment.content);
          const badge = getSeverityBadge(severity);
          
          // Calculate available width for title
          const cPrefixLen = stripAnsi(cPrefix).length;
          const badgeLen = stripAnsi(badge).length;
          const titleWidth = width - cPrefixLen - badgeLen - 1; // 1 for space
          
          const truncatedTitle = truncate(title, Math.max(10, titleWidth));
          lines.push(`${cPrefix} ${badge} ${truncatedTitle}`);
        });
      }
    });
    
    // Store total lines before scrolling
    const totalLines = lines.length;
    
    // Apply scroll offset and limit to maxHeight
    const maxScroll = Math.max(0, totalLines - maxHeight);
    const adjustedScrollOffset = Math.min(scrollOffset, maxScroll);
    const scrolled = lines.slice(adjustedScrollOffset);
    return { lines: scrolled.slice(0, maxHeight), totalLines };
  }
  
  function renderCommentDetail(state: ReviewState, width: number, maxHeight: number, scrollOffset: number = 0): { lines: string[]; totalLines: number } {
  const lines: string[] = [];
  const file = state.files[state.selectedFileIndex];
  
  if (!file || state.selectedCommentIndex < 0 || state.selectedCommentIndex >= file.comments.length) {
    lines.push(pc.dim('Select a comment to view details'));
    return { lines, totalLines: 1 };
  }
  
  const comment = file.comments[state.selectedCommentIndex];
  const { title, severity, lineStart, lineEnd, description, codeBlock, aiPrompt } = parseCommentMetadata(comment.content);
  
  // Header (only if not scrolled)
  if (scrollOffset === 0) {
    const lineInfo = `(${lineEnd > lineStart ? 'Lines' : 'Line'} ${pc.yellow(String(lineStart))}${lineEnd > lineStart ? ` to ${pc.yellow(String(lineEnd))}` : ''})`;
    const lineInfoLen = stripAnsi(lineInfo).length;
    // "File: " is 6 chars, plus space between file and line info
    const filePathText = truncateLine(file.filePath, width - 6 - lineInfoLen - 1);
    
    lines.push(`File: ${pc.cyan(filePathText)} ${lineInfo}`);
    lines.push(pc.dim('─'.repeat(Math.min(width, 80))));
    lines.push('');
    
    // Title with color (truncate if too long)
    const colorFn = getSeverityColor(severity);
    const titleText = truncateLine(title, width);
    lines.push(colorFn(pc.bold(titleText)));
    lines.push('');
  }
  
  // Description with word wrap and markdown formatting - NO TRUNCATION
  const formattedDesc = formatMarkdown(description, width - 4);
  formattedDesc.forEach(line => {
    // Don't truncate - already wrapped to fit width
    lines.push('  ' + line);
  });
  
  lines.push('');
  
  // Code block if present
  if (codeBlock) {
    // Parse details/summary
    const summaryMatch = codeBlock.match(/<summary>(.*?)<\/summary>/i);
    if (summaryMatch) {
      const summaryText = truncateLine(summaryMatch[1], width - 20);
      lines.push(pc.dim('  ┌─ Suggested Fix'));
      lines.push(pc.dim('  │'));
    }
    
    // Extract code content
    let codeContent = codeBlock
      .replace(/<details>/gi, '')
      .replace(/<\/details>/gi, '')
      .replace(/<summary>.*?<\/summary>/gi, '')
      .trim();
    
    // Remove markdown code fences if present
    codeContent = codeContent.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '');
    
    // Format code lines with syntax highlighting - NO TRUNCATION, wrap long lines
    const codeLines = codeContent.split('\n');
    codeLines.forEach((line, idx) => {
      // Wrap long lines instead of truncating
      const wrappedLines = wordWrap(line, width - 8);
      
      wrappedLines.forEach((wrappedLine, wrapIdx) => {
        let formattedLine = '';
        
        // Check for diff markers (only on first wrapped line)
        if (wrapIdx === 0 && wrappedLine.trim().startsWith('+')) {
          formattedLine = pc.green('    + ' + wrappedLine.substring(wrappedLine.indexOf('+') + 1).trim());
        } else if (wrapIdx === 0 && wrappedLine.trim().startsWith('-')) {
          formattedLine = pc.red('    - ' + wrappedLine.substring(wrappedLine.indexOf('-') + 1).trim());
        } else if (wrapIdx === 0 && wrappedLine.trim().startsWith('suggestion')) {
          formattedLine = pc.cyan('    ' + wrappedLine);
        } else {
          // Regular code - add syntax highlighting for common patterns
          let colored = wrappedLine;
          
          // Highlight strings
          colored = colored.replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, (match) => pc.green(match));
          
          // Highlight numbers
          colored = colored.replace(/\b(\d+\.?\d*)\b/g, (match) => pc.yellow(match));
          
          // Highlight keywords (common JS/TS keywords)
          const keywords = ['function', 'const', 'let', 'var', 'return', 'if', 'else', 'try', 'catch', 'throw', 'async', 'await', 'class', 'extends', 'import', 'export', 'from', 'default'];
          keywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'g');
            colored = colored.replace(regex, (match) => pc.cyan(match));
          });
          
          // Highlight function calls
          colored = colored.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, (match, fnName) => {
            return pc.magenta(fnName) + '(';
          });
          
          // Add continuation indicator for wrapped lines
          const indent = wrapIdx === 0 ? '    ' : '      ';
          formattedLine = indent + colored;
        }
        
        lines.push(formattedLine);
      });
    });
    
    if (summaryMatch) {
      lines.push(pc.dim('  └─'));
    }
    lines.push('');
  }
  
  // AI Prompt section - OUTSIDE code block, show full text without truncation
  if (aiPrompt) {
    lines.push('');
    lines.push(pc.bold(pc.yellow('┌─ Prompt to Fix with AI ✨')));
    lines.push(pc.yellow('│'));
    
    // Format AI prompt - remove markdown formatting, keep it clean
    let cleanPrompt = aiPrompt
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markers but keep text
      .replace(/\*(.*?)\*/g, '$1') // Remove italic markers but keep text
      .replace(/`([^`]+)`/g, (match, code) => pc.cyan(code)) // Highlight inline code
      .replace(/Copy this prompt to your AI IDE to fix this issue locally:?/gi, '') // Remove instruction if it leaked in
      .trim();
    
    // Word wrap accounting for "│ " prefix (2 chars) - DON'T truncate
    // Use width - 4 to account for "│ " prefix and some margin
    const promptWidth = width - 4;
    const promptLines = wordWrap(cleanPrompt, promptWidth);
    promptLines.forEach(line => {
      // Add prefix and ensure full line is shown
      const prefixedLine = pc.yellow('│ ') + line;
      lines.push(prefixedLine);
    });
    
    lines.push(pc.yellow('└─'));
    lines.push('');
  }
  
  // Store total lines before scrolling
  const totalLines = lines.length;
  
  // Apply scroll offset and limit to maxHeight
  // Don't allow scrolling beyond the actual content
  const maxScroll = Math.max(0, totalLines - maxHeight);
  const adjustedScrollOffset = Math.min(scrollOffset, maxScroll);
  const scrolled = lines.slice(adjustedScrollOffset);
  return { lines: scrolled.slice(0, maxHeight), totalLines };
}

const MOUSE_ENABLE = '\x1B[?1000h\x1B[?1002h\x1B[?1015h\x1B[?1006h';
const MOUSE_DISABLE = '\x1B[?1000l\x1B[?1002l\x1B[?1015l\x1B[?1006l';


function renderSplitView(state: ReviewState): void {
  const { width, height } = getTerminalSize();
  clearScreen();
  
  // Safety margin to prevent terminal scroll
  const safeHeight = height - 1;
  const leftWidth = Math.floor(width * 0.35);
  const rightWidth = width - leftWidth - 3;
  const contentHeight = safeHeight - 5; 
  
  // Headers with focus indicators
  const leftHeader = state.focusedPanel === 'left' 
    ? pc.cyan(pc.bold('▶ FILES / COMMENTS'))
    : pc.dim('FILES / COMMENTS');
  const rightHeader = state.focusedPanel === 'right'
    ? pc.cyan(pc.bold('▶ COMMENT DETAILS'))
    : pc.dim('COMMENT DETAILS');
  
  const leftHeaderTruncated = truncateLine(leftHeader, leftWidth);
  const rightHeaderTruncated = truncateLine(rightHeader, rightWidth);

  console.log(`${padAnsi(leftHeaderTruncated, leftWidth)} ${pc.dim('│')} ${rightHeaderTruncated}`);
  console.log(pc.dim('─'.repeat(width)));
  
  const leftResult = renderFileList(state, leftWidth, contentHeight, state.leftPanelScrollOffset);
  const rightResult = renderCommentDetail(state, rightWidth, contentHeight, state.detailScrollOffset);
  
  // Clamp variables for scrollbar calculation
  // (existing clamping logic)
  const leftMaxScroll = Math.max(0, leftResult.totalLines - contentHeight);
  const rightMaxScroll = Math.max(0, rightResult.totalLines - contentHeight);
  state.leftPanelScrollOffset = Math.min(state.leftPanelScrollOffset, leftMaxScroll);
  state.detailScrollOffset = Math.min(state.detailScrollOffset, rightMaxScroll);

  const leftLines = leftResult.lines;
  const rightLines = rightResult.lines;

  const leftLinesWithScroll = drawScrollbar(leftLines, contentHeight, leftResult.totalLines, state.leftPanelScrollOffset);
  const rightLinesWithScroll = drawScrollbar(rightLines, contentHeight, rightResult.totalLines, state.detailScrollOffset);
  
  const maxLines = Math.max(leftLines.length, rightLines.length, contentHeight);
  for (let i = 0; i < maxLines && i < contentHeight; i++) {
    const leftRaw = leftLinesWithScroll[i] || '';
    const leftTruncated = truncateLine(leftRaw, leftWidth); 
    const left = padAnsi(leftTruncated, leftWidth);
    
    const rightRaw = rightLinesWithScroll[i] || '';
    const rightVisibleLen = stripAnsi(rightRaw).length;
    const right = rightVisibleLen > rightWidth 
      ? truncateLine(rightRaw, rightWidth) 
      : rightRaw;
    
    const divider = state.focusedPanel === 'left' ? pc.cyan('│') : 
                    state.focusedPanel === 'right' ? pc.cyan('│') : 
                    pc.dim('│');
    
    const rightPadded = padAnsi(right, rightWidth);
    console.log(`${left} ${divider} ${rightPadded}`);
  }
  
  console.log(pc.dim('─'.repeat(width)));
  const scrollHint = state.focusedPanel === 'left' 
    ? `${pc.dim('↑↓: Navigate')}  |  ${pc.dim('PgUp/PgDn: Scroll Left Panel')}`
    : `${pc.dim('↑↓: Scroll Right Panel')}  |  ${pc.dim('PgUp/PgDn: Scroll Right Panel')}`;
  
  // Split footer to ensure it fits
  const footer1 = `${scrollHint}  |  ${pc.dim('Tab: Switch Panel')}  |  ${pc.dim('Mouse: Scroll/Click')}`;
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][(state.spinnerFrame || 0) % 10];
  const statusMsg = state.status === 'running' ? pc.yellow(`${spinner} Reviewing...`) : pc.green(':: Done');
  const footer2 = `${pc.dim('←/Esc: Back')}  |  ${pc.dim('c: Copy')}  |  ${pc.dim('q: Quit')}  |  ${statusMsg}`;
  
  const footer1Trunc = truncateLine(footer1, width);
  const footer2Trunc = truncateLine(footer2, width);
  
  console.log(footer1Trunc);
  // Use process.stdout.write for the last line to avoid newline triggering scroll
  process.stdout.write(footer2Trunc);
}

// ...


function renderListView(state: ReviewState): void {
  const { width, height } = getTerminalSize();
  clearScreen();
  
  const result = renderFileList(state, width, height - 4, 0);
  const lines = result.lines;
  
  // Print lines
  for (let i = 0; i < height - 4 && i < lines.length; i++) {
    console.log(lines[i]);
  }
  
  // Pad remaining
  for (let i = lines.length; i < height - 4; i++) {
    console.log('');
  }
  
  // Status bar
  console.log(pc.dim('─'.repeat(width)));
  console.log(`${pc.dim('↑↓: Navigate')}  |  ${pc.dim('→/↵: View Details')}  |  ${pc.dim('Tab: Expand/Collapse')}  |  ${pc.dim('q: Quit')}`);
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][(state.spinnerFrame || 0) % 10];
  console.log(state.status === 'running' ? pc.yellow(`${spinner} Reviewing...`) : pc.green(':: Review completed! 🎉'));
}

function render(state: ReviewState): void {
  if (state.mode === 'detail') {
    renderSplitView(state);
  } else {
    renderListView(state);
  }
}

// ==============================================================
// Navigation Logic
// ==============================================================

function getTotalNavigableItems(state: ReviewState): number {
  let count = 0;
  state.files.forEach(f => {
    count++; // file itself
    if (f.expanded) count += f.comments.length;
  });
  return count;
}

function navigateUp(state: ReviewState): ReviewState {
  const file = state.files[state.selectedFileIndex];
  
  if (state.selectedCommentIndex > 0) {
    // Move up within comments
    state.selectedCommentIndex--;
  } else if (state.selectedCommentIndex === 0) {
    // Move to file header
    state.selectedCommentIndex = -1;
  } else if (state.selectedFileIndex > 0) {
    // Move to previous file
    state.selectedFileIndex--;
    const prevFile = state.files[state.selectedFileIndex];
    if (prevFile.expanded && prevFile.comments.length > 0) {
      state.selectedCommentIndex = prevFile.comments.length - 1;
    } else {
      state.selectedCommentIndex = -1;
    }
  }
  
  // Reset detail scroll when navigating (comment might have changed)
  if (state.mode === 'detail') {
    state.detailScrollOffset = 0;
  }
  return state;
}

function navigateDown(state: ReviewState): ReviewState {
  const file = state.files[state.selectedFileIndex];
  
  if (!file) return state;
  
  if (state.selectedCommentIndex === -1) {
    // On file header
    if (file.expanded && file.comments.length > 0) {
      state.selectedCommentIndex = 0;
    } else if (state.selectedFileIndex < state.files.length - 1) {
      state.selectedFileIndex++;
      state.selectedCommentIndex = -1;
    }
  } else if (state.selectedCommentIndex < file.comments.length - 1) {
    // Move down within comments
    state.selectedCommentIndex++;
  } else if (state.selectedFileIndex < state.files.length - 1) {
    // Move to next file
    state.selectedFileIndex++;
    state.selectedCommentIndex = -1;
  }
  
  // Reset detail scroll when navigating (comment might have changed)
  if (state.mode === 'detail') {
    state.detailScrollOffset = 0;
  }
  return state;
}

function handleKeypress(state: ReviewState, key: readline.Key): { state: ReviewState; action: 'render' | 'quit' | 'copy' | 'none' } {
  if (!key) return { state, action: 'none' };
  
  const { name, ctrl } = key;
  
  // Quit
  if (name === 'q' || (ctrl && name === 'c')) {
    return { state, action: 'quit' };
  }
  
  // In detail mode, Tab switches focus between panels
  if (state.mode === 'detail' && name === 'tab') {
    state.focusedPanel = state.focusedPanel === 'left' ? 'right' : 'left';
    return { state, action: 'render' };
  }
  
  // Navigation depends on mode and focused panel
  if (state.mode === 'list' || (state.mode === 'detail' && state.focusedPanel === 'left')) {
    // In detail mode with left panel focused, check if we should scroll or navigate
    if (state.mode === 'detail' && state.focusedPanel === 'left') {
      // If Ctrl is held, scroll instead of navigate
      if (ctrl && (name === 'up' || name === 'k')) {
        state.leftPanelScrollOffset = Math.max(0, state.leftPanelScrollOffset - 1);
        return { state, action: 'render' };
      }
      if (ctrl && (name === 'down' || name === 'j')) {
        state.leftPanelScrollOffset = Math.min(1000, state.leftPanelScrollOffset + 1);
        return { state, action: 'render' };
      }
    }
    
    // Store current comment index to detect changes
    const prevCommentIndex = state.selectedCommentIndex;
    const prevFileIndex = state.selectedFileIndex;
    
    // Navigate in left panel (file list)
    if (name === 'up' || name === 'k') {
      const newState = navigateUp(state);
      // If comment changed in detail mode, reset detail scroll
      if (state.mode === 'detail' && 
          (newState.selectedCommentIndex !== prevCommentIndex || 
           newState.selectedFileIndex !== prevFileIndex)) {
        newState.detailScrollOffset = 0;
      }
      return { state: newState, action: 'render' };
    }
    
    if (name === 'down' || name === 'j') {
      const newState = navigateDown(state);
      // If comment changed in detail mode, reset detail scroll
      if (state.mode === 'detail' && 
          (newState.selectedCommentIndex !== prevCommentIndex || 
           newState.selectedFileIndex !== prevFileIndex)) {
        newState.detailScrollOffset = 0;
      }
      return { state: newState, action: 'render' };
    }
  }
  
  // In detail mode, scrolling depends on focused panel
  if (state.mode === 'detail') {
    if (state.focusedPanel === 'right') {
      // Right panel: arrow keys scroll the detail content
      // Calculate max scroll based on actual content (will be recalculated in render)
      if (name === 'up' || name === 'k') {
        state.detailScrollOffset = Math.max(0, state.detailScrollOffset - 1);
        return { state, action: 'render' };
      }
      
      if (name === 'down' || name === 'j') {
        // Limit will be enforced in renderCommentDetail
        state.detailScrollOffset = state.detailScrollOffset + 1;
        return { state, action: 'render' };
      }
    } else if (state.focusedPanel === 'left') {
      // Left panel: arrow keys scroll the file list
      // Calculate max scroll based on actual content (will be recalculated in render)
      if (name === 'up' || name === 'k') {
        state.leftPanelScrollOffset = Math.max(0, state.leftPanelScrollOffset - 1);
        return { state, action: 'render' };
      }
      
      if (name === 'down' || name === 'j') {
        // Limit will be enforced in renderFileList
        state.leftPanelScrollOffset = state.leftPanelScrollOffset + 1;
        return { state, action: 'render' };
      }
    }
  }
  
  // Enter detail view (only in list mode when a comment is selected)
  if ((name === 'right' || name === 'return') && state.selectedCommentIndex >= 0 && state.mode === 'list') {
    state.mode = 'detail';
    state.focusedPanel = 'right'; // Start with right panel focused
    state.detailScrollOffset = 0;
    state.leftPanelScrollOffset = 0;
    return { state, action: 'render' };
  }
  
  // Exit detail view - go back to list
  if ((name === 'left' || name === 'escape') && state.mode === 'detail') {
    if (state.focusedPanel === 'right') {
      // If on right panel, first move focus to left
      state.focusedPanel = 'left';
      return { state, action: 'render' };
    } else {
      // If on left panel, exit to list view
      state.mode = 'list';
      return { state, action: 'render' };
    }
  }
  
  // Toggle file expand (only in list mode or when left panel focused)
  if ((state.mode === 'list' || (state.mode === 'detail' && state.focusedPanel === 'left')) && 
      (name === 'return' && state.selectedCommentIndex === -1)) {
    const file = state.files[state.selectedFileIndex];
    if (file) {
      file.expanded = !file.expanded;
      if (!file.expanded) {
        state.selectedCommentIndex = -1;
      }
    }
    return { state, action: 'render' };
  }
  
  // Scroll in detail view - depends on focused panel
  if (state.mode === 'detail') {
    if (name === 'pagedown' || (ctrl && name === 'd')) {
      if (state.focusedPanel === 'right') {
        // Limit will be enforced in renderCommentDetail
        state.detailScrollOffset = state.detailScrollOffset + 10;
      } else {
        // Limit will be enforced in renderFileList
        state.leftPanelScrollOffset = state.leftPanelScrollOffset + 10;
      }
      return { state, action: 'render' };
    }
    if (name === 'pageup' || (ctrl && name === 'u')) {
      if (state.focusedPanel === 'right') {
        state.detailScrollOffset = Math.max(0, state.detailScrollOffset - 10);
      } else {
        state.leftPanelScrollOffset = Math.max(0, state.leftPanelScrollOffset - 10);
      }
      return { state, action: 'render' };
    }
  }
  
  // Copy AI prompt
  if (name === 'c') {
    return { state, action: 'copy' };
  }
  
  return { state, action: 'none' };
}

// ==============================================================
// Initial UI & Loading
// ==============================================================

function displayInitialUI(changes: GitChanges): void {
  const { width, height } = getTerminalSize();
  clearScreen();
  
  const topPadding = Math.max(1, Math.floor((height - 25) / 4));
  console.log('\n'.repeat(topPadding));
  
  console.log(beetleGradient(centerText(BEETLE_ASCII, width)));
  console.log();
  console.log(centerText(`repo: ${pc.dim(getRepoPath())}`, width));
  console.log();
  console.log(centerText(`comparing: ${pc.cyan(getCurrentBranch())} → ${pc.green(getDefaultBranch())} ${pc.dim('(base)')}`, width));
  console.log();
  
  if (changes.totalFiles === 0) {
    console.log(centerText(pc.yellow('No changes detected'), width));
  } else {
    console.log(centerText(`📁  ${pc.bold(`${changes.totalFiles} Files changed`)}`, width));
    console.log(centerText(`${pc.green(`+${changes.totalAdditions}`)} | ${pc.red(`-${changes.totalDeletions}`)}`, width));
    console.log();
    
    changes.files.slice(0, 8).forEach(f => {
      const status = f.status === 'added' || f.status === 'untracked' ? pc.green('A') : 
                     f.status === 'modified' ? pc.yellow('M') : pc.red('D');
      console.log(centerText(`${status}  ${f.path}`, width));
    });
    if (changes.files.length > 8) {
      console.log(centerText(pc.dim(`... and ${changes.files.length - 8} more`), width));
    }
  }
  
  console.log();
  console.log(centerText(changes.totalFiles > 0 ? pc.cyan('Hit ↵ to start review') : pc.dim('Make changes to review'), width));
  console.log('\n'.repeat(3));
  console.log(centerText(`${pc.dim('r: Refresh')}  |  ${pc.dim('q: Quit')}`, width));
  console.log(centerText(`${pc.green('✓')} ${pc.cyan(getAuthUser().email)}`, width));
}

function displayLoadingScreen(): void {
  const { width, height } = getTerminalSize();
  clearScreen();
  
  console.log('\n'.repeat(Math.floor(height / 2) - 1));
  const msg = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
  console.log(centerText(pc.cyan(msg), width));
}

// ==============================================================
// Main Review Flow
// ==============================================================

async function runReviewSession(changes: GitChanges): Promise<void> {
  // Animated Loading Screen
  let frame = 0;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const loadingMsg = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
  
  const renderLoading = () => {
    const { width, height } = getTerminalSize();
    clearScreen();
    console.log('\n'.repeat(Math.floor(height / 2) - 1));
    const spinner = frames[frame++ % frames.length];
    console.log(centerText(pc.cyan(`${spinner} ${loadingMsg}`), width));
  };
  
  renderLoading();
  const loadingInterval = setInterval(renderLoading, 80);
  
  try {
    const response = await submitReview(changes.files);
    clearInterval(loadingInterval);
    const dataId = response.extension_data_id;
    
    // Initialize state
    let state: ReviewState = {
      dataId: dataId,
      mode: 'list',
      focusedPanel: 'left',
      files: [],
      selectedFileIndex: 0,
      selectedCommentIndex: -1,
      detailScrollOffset: 0,
      leftPanelScrollOffset: 0,
      totalComments: 0,
      resolvedComments: 0,
      status: 'running',
      spinnerFrame: 0
    };
    
    // Group comments by file
    const addComments = (comments: ReviewComment[]) => {
      comments.forEach(c => {
        let fileGroup = state.files.find(f => f.filePath === c.file_path);
        if (!fileGroup) {
          fileGroup = { filePath: c.file_path, comments: [], expanded: true };
          state.files.push(fileGroup);
        }
        const exists = fileGroup.comments.some(x => x.line_start === c.line_start && x.title === c.title);
        if (!exists) {
          fileGroup.comments.push(c);
          state.totalComments++;
        }
      });
    };
    
    // Initial poll
    try {
      const initial = await pollComments(dataId);
      addComments(initial);
    } catch {}
    
    render(state);
    
    // Polling
    const pollTimer = setInterval(async () => {
      try {
        const newComments = await pollComments(dataId);
        if (newComments.length > 0) {
          addComments(newComments);
          render(state);
        }
        
        const status = await getAnalysisStatus(dataId);
        if (status.analysis_status !== 'running') {
          state.status = status.analysis_status as any;
          clearInterval(pollTimer);
          render(state);
        }
      } catch {}
    }, POLL_INTERVAL);

    const uiTimer = setInterval(() => {
      if (state.status === 'running') {
        state.spinnerFrame = (state.spinnerFrame || 0) + 1;
        render(state);
      }
    }, 100);
    
    // Keyboard handling
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    
    // Handle resize
    const handleResize = () => {
      render(state);
    };
    process.stdout.on('resize', handleResize);

    const cleanup = async () => {
      if (state.dataId) {
        await stopAnalysis(state.dataId).catch(() => {});
      }
      process.stdout.write(MOUSE_DISABLE);
      process.stdout.off('resize', handleResize);
      clearInterval(pollTimer);
      clearInterval(uiTimer);
      exitAlternateScreen();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      console.log(pc.green('\n  ✓ Review session ended.\n'));
      process.exit(0);
    };
    
    process.stdin.on('keypress', async (str, key) => {
      // Handle Mouse Events via regex on sequence
      if (key && key.sequence) {
        const mouseMatch = key.sequence.match(/\x1B\[<(\d+);(\d+);(\d+)([Mm])/);
        if (mouseMatch) {
          const b = parseInt(mouseMatch[1]);
          const x = parseInt(mouseMatch[2]);
          // const y = parseInt(mouseMatch[3]);
          const type = mouseMatch[4];
          
          const { width } = getTerminalSize();
          const leftWidth = Math.floor(width * 0.35);

          // Scroll Wheel
          if (b === 64 || b === 65) { // 64=Up, 65=Down
             const isUp = b === 64;
             const isLeft = x <= leftWidth;
             
             if (isLeft) {
                state.leftPanelScrollOffset = Math.max(0, state.leftPanelScrollOffset + (isUp ? -3 : 3));
             } else {
                state.detailScrollOffset = Math.max(0, state.detailScrollOffset + (isUp ? -3 : 3));
             }
             render(state);
             return;
          }
          
          // Click (Left Button Release)
          if (b === 0 && type === 'm') { // Left Click Release
             const isLeft = x <= leftWidth;
             if (state.mode === 'detail') {
                state.focusedPanel = isLeft ? 'left' : 'right';
                render(state);
                // We could implement clicking a file here, but focus is sufficient for now
                return;
             }
          }
        }
      }

      const result = handleKeypress(state, key);
      state = result.state;
      
      if (result.action === 'quit') {
        await cleanup();
      } else if (result.action === 'render') {
        render(state);
      } else if (result.action === 'copy') {
        const file = state.files[state.selectedFileIndex];
        if (file && state.selectedCommentIndex >= 0) {
          const c = file.comments[state.selectedCommentIndex];
          const promptMatch = c.content.match(/\*\*Prompt (?:for|to) (?:Fix with )?AI[^*]*\*\*:?\s*([\s\S]*?)(?:\n\n##|\n\n\*\*|$)/i);
          if (promptMatch) {
            try { execSync('pbcopy', { input: promptMatch[1].trim() }); } catch {}
          }
        }
      }
    });
    
    process.stdin.resume();
    
  } catch (error: any) {
    exitAlternateScreen();
    console.log(pc.red(`\n  ✗ Failed: ${error.message}\n`));
    process.exit(1);
  }
}

export async function reviewCommand(options: any = {}): Promise<void> {
  if (!requireAuth()) process.exit(1);
  if (!requireGitRepo()) process.exit(1);
  
  const stagedOnly = !!options.staged;
  
  let changes = getChangedFiles({ stagedOnly });
  
  // Direct Prompt Mode
  if (options.promptOnly) {
    await runPromptOnlyMode(changes);
    return;
  }
  
  enterAlternateScreen();
  displayInitialUI(changes);
  
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  
  const handleResize = () => {
    displayInitialUI(changes);
  };
  process.stdout.on('resize', handleResize);

  const cleanup = async () => {
    process.stdout.off('resize', handleResize);
    exitAlternateScreen();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    console.log(pc.green('\n  ✓ Session ended.\n'));
    process.exit(0);
  };
  
  process.stdin.on('keypress', async (str, key) => {
    if (!key) return;
    
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      await cleanup();
    } else if (key.name === 'r') {
      changes = getChangedFiles({ stagedOnly });
      displayInitialUI(changes);
    } else if (key.name === 'return' && changes.totalFiles > 0) {
      process.stdin.removeAllListeners('keypress');
      process.stdout.off('resize', handleResize);
      await runReviewSession(changes);
    }
  });
  
  process.stdin.resume();
}
