import WebSocket from "ws";
import crypto from "node:crypto";

import { Logger } from "../util/log.js";
import { boundedBackoffDelay } from "../util/time.js";

export interface AlertWebsocketClientOptions {
  url: string;
  logger: Logger;
  onMessage: (message: string) => Promise<void> | void;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  reconnectMaxDelayMs: number;
  origin: string;
}

function hasMissedHeartbeatWindow(
  lastTickAt: number,
  now: number,
  pingIntervalMs: number,
  pingTimeoutMs: number
): boolean {
  return now - lastTickAt > pingIntervalMs + pingTimeoutMs;
}

export class AlertWebsocketClient {
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimeoutTimer: NodeJS.Timeout | null = null;
  private livelinessTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private lastHeartbeatTickAt = Date.now();

  constructor(private readonly options: AlertWebsocketClientOptions) {}

  start(): void {
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
      setTimeout(resolve, 1_000);
    });
  }

  private connect(): void {
    if (this.stopping) {
      return;
    }

    this.options.logger.info("Connecting to alert websocket", { url: this.options.url });
    const tzofarHeader = crypto.randomBytes(16).toString("hex");
    const socket = new WebSocket(this.options.url, {
      origin: this.options.origin,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: "https://www.tzevaadom.co.il",
        tzofar: tzofarHeader
      }
    });
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.lastHeartbeatTickAt = Date.now();
      this.options.logger.info("Connected to alert websocket");
      this.startHeartbeat(socket);
    });

    socket.on("error", (error) => {
      this.options.logger.warn("Websocket error", { error: error.message });
    });

    socket.on("message", async (data) => {
      this.clearPongTimeout();
      try {
        await this.options.onMessage(data.toString());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.logger.error("Failed to process websocket message", { error: message });
      }
    });

    socket.on("pong", () => {
      this.clearPongTimeout();
    });

    socket.on("close", (code) => {
      this.clearHeartbeatTimers();
      this.options.logger.warn("Websocket closed", { code });
      if (this.socket === socket) {
        this.socket = null;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    const delayMs = boundedBackoffDelay(this.reconnectAttempt, this.options.reconnectMaxDelayMs);
    this.reconnectAttempt += 1;

    this.options.logger.info("Scheduling websocket reconnect", { delayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clearHeartbeatTimers();
  }

  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeatTimers();
    this.lastHeartbeatTickAt = Date.now();

    const tick = (): void => {
      if (this.stopping || this.socket !== socket) {
        return;
      }

      const now = Date.now();
      if (
        hasMissedHeartbeatWindow(
          this.lastHeartbeatTickAt,
          now,
          this.options.pingIntervalMs,
          this.options.pingTimeoutMs
        )
      ) {
        this.options.logger.warn("Detected stale websocket heartbeat window, forcing reconnect", {
          gapMs: now - this.lastHeartbeatTickAt
        });
        socket.terminate();
        return;
      }

      this.lastHeartbeatTickAt = now;

      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        socket.ping();
      } catch (error) {
        this.options.logger.warn("Failed to send websocket ping, forcing reconnect", {
          error: error instanceof Error ? error.message : String(error)
        });
        socket.terminate();
        return;
      }

      this.clearPongTimeout();
      this.pongTimeoutTimer = setTimeout(() => {
        this.pongTimeoutTimer = null;
        if (this.stopping || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        this.options.logger.warn("Websocket ping timed out, forcing reconnect", {
          pingTimeoutMs: this.options.pingTimeoutMs
        });
        socket.terminate();
      }, this.options.pingTimeoutMs);
    };

    this.pingTimer = setInterval(tick, this.options.pingIntervalMs);
    this.livelinessTimer = setInterval(() => {
      if (this.stopping || this.socket !== socket) {
        return;
      }

      const now = Date.now();
      if (
        hasMissedHeartbeatWindow(
          this.lastHeartbeatTickAt,
          now,
          this.options.pingIntervalMs,
          this.options.pingTimeoutMs
        )
      ) {
        this.options.logger.warn("Detected system sleep/wake gap, forcing websocket reconnect", {
          gapMs: now - this.lastHeartbeatTickAt
        });
        socket.terminate();
      }
    }, this.options.pingIntervalMs);
  }

  private clearHeartbeatTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.livelinessTimer) {
      clearInterval(this.livelinessTimer);
      this.livelinessTimer = null;
    }

    this.clearPongTimeout();
  }

  private clearPongTimeout(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }
}

export { hasMissedHeartbeatWindow };
