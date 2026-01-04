// src/server.ts
// llm-service V4 - HTTP Service for LLM Inference Routing to Ollama
// Port 3456 - Pure routing, no intelligence

import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { inferRouter } from './routes/infer.js';
import { modelsRouter } from './routes/models.js';

const app = express();
const PORT = process.env.LLM_SERVICE_PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    console.log(`[llm-service] ${req.method} ${req.path} - ${res.statusCode} (${Date.now() - startTime}ms)`);
  });
  
  next();
});

// Routes
app.use(healthRouter);
app.use(inferRouter);
app.use(modelsRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[llm-service] Error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[llm-service] Running on port ${PORT}`);
  console.log(`[llm-service] Ollama endpoint: http://localhost:11434`);
  console.log(`[llm-service] Model: ${process.env.OLLAMA_MODEL || '(from request)'}`);
});

export { app };
