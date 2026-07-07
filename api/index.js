import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenAI client with high-speed performance flags
function getClient() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": "https://localhost:3000", 
      "X-Title": "Fastest Free Router App",
      // CRITICAL FOR SPEED: Forces OpenRouter to use Nitro (fastest latency) routing mode
      "openrouter/provider-routing": "nitro"
    }
  });
}

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

// Enforce "openrouter/free" as the default auto-routing slug
const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  model: z.string().default("openrouter/free"), 
  max_tokens: z.number().int().positive().max(4096).default(4096), // Lowered slightly for faster generation times
  temperature: z.number().min(0).max(2).default(1),
});

// Health check
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Simple GET — Pass message as ?q=
app.get("/api/ask", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing ?q= parameter. Example: /api/ask?q=hello" });
  }

  try {
    const client = getClient();
    const modelToUse = (req.query.model as string) || "openrouter/free";

    const completion = await client.chat.completions.create({
      model: modelToUse,
      messages: [{ role: "user", content: q }],
      max_tokens: 4096,
    });

    const content = completion.choices?.message?.content ?? "";
    const usage = completion.usage;

    res.json({
      content,
      model: completion.model, // OpenRouter outputs the specific fast free model chosen here
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// List all OpenRouter models
app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    res.json(await response.json());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Non-streaming chat (POST with full control fallback)
app.post("/api/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { messages, model, max_tokens, temperature } = parsed.data;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model,
      messages,
      max_tokens,
      temperature,
    });

    const content = completion.choices?.message?.content ?? "";
    const usage = completion.usage;

    res.json({
      content,
      model: completion.model,
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// Streaming chat (SSE) - Ideal for making your app feel instant to users
app.post("/api/chat/stream", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { messages, model, max_tokens, temperature } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const client = getClient();
    const stream = await client.chat.completions.create({
      model,
      messages,
      max_tokens,
      temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default app;
