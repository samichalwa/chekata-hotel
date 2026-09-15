import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { sessionMiddleware, environmentMiddleware } from "./auth";
import { schemaReady, storage } from "./storage";
import { runTenantBillingCycle } from "./billing";
import { startTestMessageLogPurgeSchedule } from "./test-environment";

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);
app.use(sessionMiddleware);
// Routes every downstream `storage`/`db`/`sql` call in this request to Live
// or Test based on the signed-in user's session — see server/auth.ts and
// server/db-context.ts (Phase 6: Test/Live environment split).
app.use(environmentMiddleware);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    // Raised from the 100kb default so base64-encoded ID-document / lease-document
    // uploads (POST /api/tenants/uploads, /api/accommodation/uploads) fit in a plain
    // JSON body instead of needing multipart/form-data.
    limit: "15mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await schemaReady;
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Phase 3: tenant rent billing cycle — creates the current-period rent invoice
  // (and emails its PDF) for every active lease that doesn't have one yet, then
  // sends SMS + email reminders for unpaid invoices past their configured
  // reminder window. Idempotent, so re-running (deploy restart, hourly tick) is
  // always safe. Runs once at boot, then hourly.
  function runBillingCycleLogged() {
    runTenantBillingCycle(storage)
      .then((r) => {
        log(
          `tenant billing cycle: ${r.invoicesCreated} invoiced, ${r.invoicesSkipped} skipped, ${r.remindersSent} reminders sent`,
        );
        if (r.invoiceErrors.length) log(`tenant billing cycle invoice errors: ${JSON.stringify(r.invoiceErrors)}`);
        if (r.reminderErrors.length) log(`tenant billing cycle reminder errors: ${JSON.stringify(r.reminderErrors)}`);
      })
      .catch((e) => log(`tenant billing cycle failed: ${e?.message ?? e}`));
  }
  runBillingCycleLogged();
  setInterval(runBillingCycleLogged, 60 * 60 * 1000);

  // Phase 6: auto-purge intercepted Test-mode messages older than 30 days.
  startTestMessageLogPurgeSchedule();

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
