#!/usr/bin/env node

import { Command } from 'commander';
import { intro, outro, note } from '@clack/prompts';
import gradient from 'gradient-string';
import pc from 'picocolors';
import { loginCommand, logoutCommand, statusCommand } from './commands/auth.js';

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
const COMMANDS = [
  { command: 'beetle auth login', description: 'Authenticate with your Beetle account' },
  { command: 'beetle auth logout', description: 'Log out from your account' },
  { command: 'beetle auth status', description: 'Check authentication status' },
  { command: 'beetle init', description: 'Initialize Beetle in your project' },
  { command: 'beetle review', description: 'Start a code review on current branch' },
  { command: 'beetle config', description: 'Configure Beetle settings' },
  { command: 'beetle help', description: 'Show all available commands' },
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
 * Display common commands in a formatted way
 */
function displayCommands(): void {
  const commandsFormatted = COMMANDS
    .map(({ command, description }) => 
      `  ${pc.cyan(command.padEnd(24))} ${pc.dim(description)}`
    )
    .join('\n');

  console.log(pc.bold('\n  📋 Common Commands:\n'));
  console.log(commandsFormatted);
  console.log();
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
  .version('1.0.0');

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

// Placeholder commands (to be implemented)
program
  .command('init')
  .description('Initialize Beetle in your project')
  .action(() => {
    intro(pc.bgCyan(pc.black(' beetle init ')));
    note('This command will be implemented soon.', 'Coming Soon');
    outro(pc.dim('Stay tuned!'));
  });

program
  .command('review')
  .description('Start a code review on current branch')
  .action(() => {
    intro(pc.bgCyan(pc.black(' beetle review ')));
    note('This command will be implemented soon.', 'Coming Soon');
    outro(pc.dim('Stay tuned!'));
  });

program
  .command('config')
  .description('Configure Beetle settings')
  .action(() => {
    intro(pc.bgCyan(pc.black(' beetle config ')));
    note('This command will be implemented soon.', 'Coming Soon');
    outro(pc.dim('Stay tuned!'));
  });

program
  .command('status')
  .description('Check current review status')
  .action(() => {
    intro(pc.bgCyan(pc.black(' beetle status ')));
    note('This command will be implemented soon.', 'Coming Soon');
    outro(pc.dim('Stay tuned!'));
  });

// Default action (no command) - show welcome
program.action(() => {
  showWelcome();
});

// Parse arguments
program.parse();
