import * as vscode from 'vscode';

/**
 * Logger that outputs to VS Code's Output panel
 */
class Logger {
  private outputChannel: vscode.OutputChannel | null = null;

  /**
   * Initialize the output channel
   */
  public init(): void {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('Roblox Super Require');
    }
  }

  /**
   * Log an info message
   */
  public info(message: string): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = `[${timestamp}] INFO: ${message}`;
    console.log(`[Super Require] ${message}`);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Log a debug message
   */
  public debug(message: string): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = `[${timestamp}] DEBUG: ${message}`;
    console.log(`[Super Require] ${message}`);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Log an error message
   */
  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = `[${timestamp}] ERROR: ${message}`;
    console.error(`[Super Require] ${message}`, error);
    this.outputChannel?.appendLine(formatted);
    if (error) {
      this.outputChannel?.appendLine(`  ${String(error)}`);
    }
  }

  /**
   * Log a warning message
   */
  public warn(message: string): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = `[${timestamp}] WARN: ${message}`;
    console.warn(`[Super Require] ${message}`);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Show the output channel
   */
  public show(): void {
    this.outputChannel?.show(true);
  }

  /**
   * Dispose the output channel
   */
  public dispose(): void {
    this.outputChannel?.dispose();
    this.outputChannel = null;
  }
}

// Export singleton instance
export const logger = new Logger();
