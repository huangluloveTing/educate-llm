import { z } from "zod/v4";

const isTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: isTest
    ? z.string().min(1).default("postgresql://localhost:5432/test")
    : z.string().min(1),
  JWT_SECRET: isTest
    ? z.string().min(1).default("test_jwt_secret")
    : z.string().min(1),

  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  // LLM key can be empty in early dev; endpoints that call LLM will fail with a clear message.
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().min(1).default("gpt-4.1-mini"),

  EMBED_BASE_URL: z.string().optional(),
  EMBED_API_KEY: z.string().optional(),
  EMBED_MODEL: z.string().min(1).default("text-embedding-3-small"),

  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),

  STORAGE_DIR: z.string().min(1).default("../../storage"),
  PDF_FONT_PATH: z.string().optional(),
});

try {
  // eslint-disable-next-line node/no-process-env
  envSchema.parse(process.env);
}
catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Missing environment variables:", error.issues.map(issue => issue.path.join(".")));
  }
  else {
    console.error(error);
  }
  process.exit(1);
}

// eslint-disable-next-line node/no-process-env
export const env = envSchema.parse(process.env);
