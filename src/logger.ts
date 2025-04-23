import chalk from 'chalk';

type LoggingMode = 'verbose' | 'error' | 'none';

export type LoggerOptions = {
  mode: LoggingMode;
};

export type LogTypeOptions = 'info' | 'error' | 'success' | 'warning' | 'default';

export const consoleStyles = {
  prompt: chalk.green('You: '),
  assistant: chalk.blue('Claude: '),
  tool: {
    name: chalk.cyan.bold,
    args: chalk.yellow,
    bracket: chalk.dim,
  },
  error: chalk.red,
  info: chalk.blue,
  success: chalk.green,
  warning: chalk.yellow,
  separator: chalk.gray('─'.repeat(50)),
  default: chalk.white,
};

export class Logger {
  private mode: LoggingMode = 'verbose';

  constructor({ mode }: LoggerOptions) {
    this.mode = mode;
  }

  // Static method to create a default logger
  static createDefault(): Logger {
    // Get mode from environment variable or use verbose as default
    const mode = (process.env.LOG_MODE as LoggingMode) || 'verbose';
    return new Logger({ mode });
  }

  log(
    message: string,
    options?: { type?: LogTypeOptions },
  ) {
    if (this.mode === 'none') return;
    if (this.mode === 'error' && options?.type !== 'error') return;

    const styleFunction = consoleStyles[options?.type ?? 'default'];
    process.stdout.write(styleFunction(message));
  }

  // Convenience methods for different log types
  info(message: string) {
    this.log(message, { type: 'info' });
  }

  error(message: string) {
    this.log(message, { type: 'error' });
  }

  success(message: string) {
    this.log(message, { type: 'success' });
  }

  warning(message: string) {
    this.log(message, { type: 'warning' });
  }

  // Method for logging tool usage
  toolCall(name: string, args: Record<string, any>) {
    if (this.mode === 'none') return;
    
    const formattedArgs = JSON.stringify(args, null, 2);
    const toolName = consoleStyles.tool.name(name);
    const toolArgs = consoleStyles.tool.args(formattedArgs);
    const openBracket = consoleStyles.tool.bracket('[');
    const closeBracket = consoleStyles.tool.bracket(']');
    
    this.log(`${openBracket}Tool Call: ${toolName}${closeBracket}\n${toolArgs}\n\n`);
  }

  // Method for logging separators
  separator() {
    this.log(`${consoleStyles.separator}\n`);
  }
}
