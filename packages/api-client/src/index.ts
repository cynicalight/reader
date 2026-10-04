import createClient from "openapi-fetch";
import type { paths } from "./schema";
import type {
  Document,
  DocumentLocation,
  Annotation,
  SearchResult,
  Provider,
  Message,
  ReaderTheme,
  SourceReference,
  Processing,
  PDFBlock,
  AIConfig,
  AICapability,
} from "@reader/core";
let sessionToken = "";
export function configureAPI(token: string) {
  sessionToken = token;
}
export function publicationURL(documentId: string, resource: string) {
  return `/pub/${encodeURIComponent(sessionToken)}/${encodeURIComponent(documentId)}/${resource}`;
}
export function blockImageURL(documentId: string, blockId: string) {
  return publicationURL(
    documentId,
    `assets/${encodeURIComponent(blockId)}.png`,
  );
}
export const client = createClient<paths>();
client.use({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${sessionToken}`);
    return request;
  },
});
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  processing: () => request<Processing[]>("/api/processing"),
  process: (id: string) =>
    request<Processing>(`/api/documents/${id}/processing`, { method: "POST" }),
  blocks: (id: string) => request<PDFBlock[]>(`/api/documents/${id}/blocks`),
  aiConfig: () => request<AIConfig>("/api/ai/config"),
  saveAIConfig: (config: AIConfig) =>
    request<AIConfig>("/api/ai/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  testAI: (provider: string) =>
    request<AICapability>(`/api/ai/test/${provider}`, { method: "POST" }),
  documents: async (): Promise<Document[]> => {
    const { data, error } = await client.GET("/api/documents");
    if (error) throw new Error(error.error);
    return data;
  },
  import: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Document>("/api/documents", { method: "POST", body: form });
  },
  update: (
    id: string,
    patch: {
      favorite?: boolean;
      progress?: DocumentLocation;
      percentage?: number;
    },
  ) =>
    request<Document>(`/api/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  annotations: (id: string) =>
    request<Annotation[]>(`/api/documents/${id}/annotations`),
  annotate: (
    id: string,
    annotation: Pick<
      Annotation,
      "kind" | "location" | "quote" | "note" | "color"
    >,
  ) =>
    request<Annotation>(`/api/documents/${id}/annotations`, {
      method: "POST",
      body: JSON.stringify(annotation),
    }),
  removeAnnotation: (id: string, annotation: string) =>
    request<void>(`/api/documents/${id}/annotations/${annotation}`, {
      method: "DELETE",
    }),
  search: (id: string, query: string) =>
    request<SearchResult[]>(
      `/api/documents/${id}/search?q=${encodeURIComponent(query)}`,
    ),
  messages: (id: string) => request<Message[]>(`/api/documents/${id}/messages`),
  providers: () => request<Provider[]>("/api/providers"),
  settings: () => request<Partial<ReaderTheme>>("/api/settings"),
  saveSettings: (theme: ReaderTheme) =>
    request<ReaderTheme>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(theme),
    }),
};
export async function chat(
  id: string,
  provider: string,
  prompt: string,
  context: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  references: SourceReference[] = [],
  attachments: string[] = [],
  onFallback?: (message: string) => void,
) {
  const response = await fetch(`/api/documents/${id}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      prompt,
      context,
      references,
      attachments,
    }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "AI 请求失败");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("没有收到 AI 输出");
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = frame
          .split("\n")
          .find((l) => l.startsWith("event: "))
          ?.slice(7);
        const raw = frame
          .split("\n")
          .find((l) => l.startsWith("data: "))
          ?.slice(6);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === "error") throw new Error(data.error);
        if (event === "delta") onDelta(data.text);
        if (event === "fallback") onFallback?.(data.message);
        if (event === "done") done = true;
      }
    }
    if (!done) throw new Error("AI 连接中断，回答未保存");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
