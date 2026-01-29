# Beetle CLI 🪲

**AI-Powered Code Review**

Beetle is a powerful CLI tool that brings AI code reviews directly to your terminal. It analyzes your Git changes and provides actionable feedback, suggested fixes, and optimized prompts for your favorite AI-powered IDE.

---

## 🚀 Quick Start

### Installation
```bash
npm install -g @beetleai_dev/beetle
```

### Usage
Run `beetle` in any Git repository to get started:
```bash
beetle review
```

---

## 🛠️ Commands

### Authentication
Manage your Beetle account and access.
| Command | Description |
|:---|:---|
| `beetle auth login` | Authenticate with your Beetle account via browser. |
| `beetle auth logout` | Log out from your current session. |
| `beetle auth status` | Check your current authentication status. |

### Reviewing Code
The core feature of Beetle. Analyze your changes before you push.
| Command | Description |
|:---|:---|
| `beetle review` | Start an interactive code review on your current branch. |
| `beetle review --staged` | Review only the files currently in your Git staging area. |
| `beetle review --all` | Review all modified files (default behavior). |
| `beetle review --prompt-only` | Stream AI prompts directly to the terminal (no interactive UI). |

### General
| Command | Description |
|:---|:---|
| `beetle help` | Show all available commands and help. |
| `beetle -v` | Output the current version number. |

---

## 💡 Case Study: Streamlining Code Reviews

Imagine you're Working on a new feature that involves complex state management. Before opening a Pull Request, you want to ensure the code is clean and follow best practices.

1.  **Run Review**: You execute `beetle review --staged` after staging your changes.
2.  **Analysis**: Beetle identifies a potential memory leak in your `useEffect` hook.
3.  **Insight**: In the interactive split-view terminal, you see:
    -   **Severity**: High
    -   **Issue**: Missing cleanup function in `useEffect`.
    -   **Suggested Fix**: A code snippet showing how to correctly return a cleanup function.
    -   **AI Prompt**: A pre-crafted prompt like: *"Fix the potential memory leak in this React component by adding a cleanup function to the useEffect hook."*
4.  **Fix**: You copy the AI prompt, paste it into your IDE (Cursor/Copilot), and the issue is resolved in seconds.

By using Beetle, you catch critical issues locally, reducing review cycles and improving code quality before anyone else even sees your code.

---

## ✨ Features

- **Interactive UI**: A sleek, terminal-based dashboard with split-view for files and comments.
- **Severity Levels**: Bug's are categorized by severity (Critical, High, Medium, Low) so you know what to fix first.
- **Smart Prompts**: Automatically generated prompts tailored for AI IDEs to help you apply fixes instantly.
- **Git Integrated**: Works seamlessly with your existing Git workflow.

---

## 📄 License
ISC License. See `LICENSE` for details.
