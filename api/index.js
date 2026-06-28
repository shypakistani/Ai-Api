import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

function getClient() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  model: z.string().default("google/gemini-2.5-flash"),
  max_tokens: z.number().int().positive().max(8192).default(8192),
  temperature: z.number().min(0).max(2).default(1),
});

// Health check
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// List all OpenRouter models
app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    res.json(await response.json());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Non-streaming chat
app.post("/api/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { messages, model, max_tokens, temperature } = parsed.data;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({ model, messages, max_tokens, temperature });
    const content = completion.choices[0]?.message?.content ?? "";
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
    const stream = await client.chat.completions.create({ model, messages, max_tokens, temperature, stream: true });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
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
