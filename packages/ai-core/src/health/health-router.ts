import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { createLogger } from "../core/logger.js";
import { runHealthChecks, SystemHealth } from "./health-checks.js";

const logger = createLogger("health-router");

export interface HealthRouterConfig {
  port: number;
  host?: string;
}

export interface HealthRouter {
  server: Server;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_CONFIG: HealthRouterConfig = {
  port: 8280,
  host: "0.0.0.0",
};

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

function transformHealthToReady(health: SystemHealth): {
  status: "healthy" | "degraded";
  failures: string[];
  timestamp: string;
} {
  return {
    status: health.overall === "down" ? "degraded" : health.overall,
    failures: health.failures,
    timestamp: health.timestamp,
  };
}

export function createHealthRouter(config?: Partial<HealthRouterConfig>): HealthRouter {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  let server: Server | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url || "/";
    const method = req.method || "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method !== "GET") {
      sendError(res, 405, "Method not allowed");
      return;
    }

    try {
      if (url === "/health" || url === "/health/") {
        // Liveness check - simple 200 OK
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (url === "/ready" || url === "/ready/") {
        // Readiness check - run all health checks
        const health = await runHealthChecks();
        const ready = transformHealthToReady(health);

        const statusCode = ready.status === "healthy" ? 200 : 503;
        sendJson(res, statusCode, ready);
        return;
      }

      // Unknown endpoint
      sendError(res, 404, "Not found");
    } catch (error: unknown) {
      logger.error("Health router error", { error: String(error) });
      sendError(res, 500, "Internal server error");
    }
  };

  const start = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (server) {
        resolve();
        return;
      }

      server = createServer(requestHandler);

      server.on("error", (error) => {
        logger.error("Health server error", { error: String(error) });
        reject(error);
      });

      server.listen(fullConfig.port, fullConfig.host, () => {
        logger.info(`Health router listening on ${fullConfig.host}:${fullConfig.port}`);
        resolve();
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(() => {
        logger.info("Health router stopped");
        server = null;
        resolve();
      });
    });
  };

  return {
    get server() {
      if (!server) {
        throw new Error("Health router not started");
      }
      return server;
    },
    start,
    stop,
  };
}

// Singleton instance for convenience
let globalHealthRouter: HealthRouter | null = null;

export function startGlobalHealthRouter(config?: Partial<HealthRouterConfig>): Promise<void> {
  if (!globalHealthRouter) {
    globalHealthRouter = createHealthRouter(config);
  }
  return globalHealthRouter.start();
}

export function stopGlobalHealthRouter(): Promise<void> {
  if (!globalHealthRouter) {
    return Promise.resolve();
  }
  const router = globalHealthRouter;
  globalHealthRouter = null;
  return router.stop();
}

export function getGlobalHealthRouter(): HealthRouter | null {
  return globalHealthRouter;
}
