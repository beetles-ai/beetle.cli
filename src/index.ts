#!/usr/bin/env node

import { Command } from 'commander';
import { intro, outro, note } from '@clack/prompts';
import gradient from 'gradient-string';
import pc from 'picocolors';
import { loginCommand, logoutCommand, statusCommand } from './commands/auth.js';
import { reviewCommand } from './commands/review.js';

// Linear gradient for BEETLE branding
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

// Common commands to display after installation
// Command groups for help display
const COMMAND_GROUPS = [
  {
    title: 'Authentication',
    commands: [
      { command: 'beetle auth login', description: 'Authenticate with your Beetle account' },
      { command: 'beetle auth logout', description: 'Log out from your account' },
      { command: 'beetle auth status', description: 'Check authentication status' },
    ]
  },
  {
    title: 'Review',
    commands: [
      { command: 'beetle review', description: 'Start a code review on current branch' },
      { command: 'beetle review --staged', description: 'Review only staged files' },
      { command: 'beetle review --prompt-only', description: 'Stream AI prompts only (no interactive UI)' },
    ]
  },
  {
    title: 'Options',
    commands: [
      { command: '-v, --version', description: 'Output the version number' },
      { command: '-h, --help', description: 'Display help for command' },
    ]
  }
];

/**
 * Display the BEETLE intro with gradient ASCII art
 */
function displayIntro(): void {
  console.clear();
  console.log(beetleGradient(BEETLE_ASCII));
  console.log(pc.dim('  AI-Powered Code Review Assistant\n'));
}

/**
 * Display commands in formatted groups
 */
function displayCommands(): void {
  COMMAND_GROUPS.forEach(group => {
    console.log(pc.bold(`  ${group.title}:`));
    const commandLines = group.commands
      .map(({ command, description }) => 
        `    ${pc.cyan(command.padEnd(28))} ${pc.dim(description)}`
      )
      .join('\n');
    console.log(commandLines);
    console.log();
  });
}

/**
 * Main entry point - show welcome screen
 */
function showWelcome(): void {
  displayIntro();
  
  intro(pc.bgCyan(pc.black(' beetle-cli ')));
  
  note(
    `Welcome to Beetle CLI! 🪲\n\nBeetle is now installed and ready to use.\nRun ${pc.cyan('beetle help')} for more information.`,
    'Installation Complete'
  );
  
  displayCommands();
  
  outro(pc.green('✓ Happy coding with Beetle!'));
}

// Create CLI program
const program = new Command();

program
  .name('beetle')
  .description('AI-Powered Code Review Assistant CLI')
  .version('0.0.1', '-v, --version');

// Auth commands
const authCommand = program
  .command('auth')
  .description('Manage authentication');

authCommand
  .command('login')
  .description('Log in to your Beetle account')
  .action(async () => {
    await loginCommand();
  });

authCommand
  .command('logout')
  .description('Log out from your Beetle account')
  .action(async () => {
    await logoutCommand();
  });

authCommand
  .command('status')
  .description('Check your authentication status')
  .action(async () => {
    await statusCommand();
  });



program
  .command('review')
  .description('Start a code review on current branch')
  .option('--prompt-only', 'Extract and show only AI prompts')
  .option('--staged', 'Review only staged files')
  .option('--all', 'Review all changed files (default)')
  .action(async (options) => {
    await reviewCommand(options);
  });



program
  .command('help')
  .alias('h')
  .description('Show all available commands')
  .action(() => {
    displayIntro();
    displayCommands();
  });

// Default action (no command) - show welcome
program.action(() => {
  showWelcome();
});

// Parse arguments
program.parse();
