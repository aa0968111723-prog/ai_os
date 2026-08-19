import {
  cutosHealthSchema,
  cutosInvokeResponseSchema,
  cutosManifestSchema,
  type CutosHealth,
  type CutosInvokeRequest,
  type CutosInvokeResponse,
  type CutosManifest,
} from "../../shared/cutosProtocol";

export interface CutosClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class CutosClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CutosClientError";
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function readJsonSafely(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export class CutosClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: CutosClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init?.headers);
      headers.set("accept", "application/json");
      if (init?.body) headers.set("content-type", "application/json");
      if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const payload = readJsonSafely(await response.text());
      if (!response.ok) {
        const candidate = payload as { error?: { code?: string; message?: string }; message?: string };
        throw new CutosClientError(
          candidate.error?.message ?? candidate.message ?? `CUTOS request failed (${response.status})`,
          response.status,
          candidate.error?.code,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof CutosClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new CutosClientError("CUTOS request timed out", undefined, "TIMEOUT");
      }
      throw new CutosClientError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  async manifest(): Promise<CutosManifest> {
    return cutosManifestSchema.parse(await this.request("/api/aios/manifest"));
  }

  async invoke(request: CutosInvokeRequest): Promise<CutosInvokeResponse> {
    return cutosInvokeResponseSchema.parse(
      await this.request("/api/aios/invoke", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    );
  }

  async health(): Promise<CutosHealth> {
    return cutosHealthSchema.parse(await this.request("/api/aios/health"));
  }
}

export interface CutosEnvironmentConfig {
  configured: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

export function readCutosEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): CutosEnvironmentConfig {
  const baseUrl = env.CUTOS_URL?.trim();
  const timeout = Number(env.CUTOS_TIMEOUT_MS ?? "15000");
  return {
    configured: Boolean(baseUrl),
    baseUrl: baseUrl || undefined,
    apiKey: env.CUTOS_API_KEY?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000,
  };
}

export function createConfiguredCutosClient(env: NodeJS.ProcessEnv = process.env): CutosClient | null {
  const config = readCutosEnvironmentConfig(env);
  if (!config.configured || !config.baseUrl) return null;
  return new CutosClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: config.timeoutMs });
}
