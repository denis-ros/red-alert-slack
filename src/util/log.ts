export type LogLevelName = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(private readonly level: LogLevelName = "info") {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  private log(level: LogLevelName, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const suffix = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
    const line = `${timestamp} ${level.toUpperCase()} ${message}${suffix}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }
}

