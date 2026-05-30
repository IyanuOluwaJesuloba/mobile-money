import express, { Request, Response } from "express";
import webhookRoutes from "./routes/webhook";
import { config } from "./config/env";

const app = express();

// Preserve raw request body buffer for signature verification middleware.
app.use(
  express.json({
    verify: (req: any, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  }),
);

app.get("/", (req: Request, res: Response) => {
  res.send("Bridge Starter API running 🚀");
});

app.use("/api", webhookRoutes);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});