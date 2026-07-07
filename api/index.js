import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenAI client with structural guarantees
function getClient() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": "https://localhost:3000", 
      "X-Title": "Guaranteed Free Router App",
      // CRITICAL FOR ZERO COST: Disables all paid provider fallbacks completely
      "openrouter/provider-routing": "nitro"
    }
  });
}

// Strict schema validation that completely blocks outside model overrides
const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  // Hardcoded literal: This endpoint rejects any incoming request trying to specify a paid model
  model: z.literal("openrouter/free").default("openrouter/free"), 
  max_tokens: z.number().int().positive().max(4096).default(4096),
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
    return res.status(400).json({ error: "Missing ?q= parameter." });
  }

  try {
    const client = getClient();

    // FORCE FREE MODEL: Completely ignored req.query.model to prevent unintended paid calls
    const completion = await client.chat.completions.create({
      model: "openrouter/free", 
      messages: [{ role: "user", content: q }],
      max_tokens: 4096,
    });

    const content = completion.choices?.message?.content ?? "";
    const usage = completion.usage;

    res.json({
      content,
      model: completion.model, // Confirms the exact free fallback engine chosen
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

// Non-streaming chat (POST with hardlocked free constraint)
app.post("/api/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request. Only 'openrouter/free' is permitted.", details: parsed.error.flatten() });
  }

  const { messages, model, max_tokens, temperature } = parsed.data;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model, // Will always evaluate exactly to "openrouter/free"
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

// Streaming chat (SSE)
app.post("/api/chat/stream", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request. Only 'openrouter/free' is permitted.", details: parsed.error.flatten() });
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
