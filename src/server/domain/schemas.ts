import { z } from 'zod';

export const createModelSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.enum(['openai', 'openai-compatible']),
  modelId: z.string().min(1).max(200),
  baseUrl: z.string().url().optional().or(z.literal('')),
  apiKeyEnv: z.string().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  modelRef: z.string().uuid(),
  instructions: z.string().min(1).max(50_000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(100_000),
  sessionId: z.string().uuid().optional(),
});
