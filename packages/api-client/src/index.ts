import {
  consumeTranslationStream,
  type TranslationEvent,
} from "./translation-stream";
import { consumeChatStream, type ChatStreamEvent } from "./chat-stream";
export { ChatStreamError, type ChatStreamEvent } from "./chat-stream";
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";
import type {
  Document,
  TagBoard,
  DocumentLocation,
  Annotation,
  SearchResult,
  Provider,
  Message,
  ReaderTheme,
  SourceReference,
  Processing,
  ProcessingUsage,
  PDFBlock,
  AIConfig,
  AICapability,
  AgentModel,
  LibraryMode,
  LibraryPreferences,
  PaperMetadata,
  PaperMetadataField,
  ReadingStatus,
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
  chatUsage: (id: string) =>
    request<ProcessingUsage>(
      `/api/documents/${encodeURIComponent(id)}/chat-usage`,
    ),
  processingUsage: (id: string) =>
    request<ProcessingUsage>(
      `/api/documents/${encodeURIComponent(id)}/processing-usage`,
    ),
  tagBoards: () => request<TagBoard[]>("/api/tag-boards"),
  createTagBoard: (board: Omit<TagBoard, "id">) =>
    request<TagBoard>("/api/tag-boards", {
      method: "POST",
      body: JSON.stringify(board),
    }),
  updateTagBoard: (id: string, board: Omit<TagBoard, "id">) =>
    request<TagBoard>(`/api/tag-boards/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(board),
    }),
  removeTagBoard: (id: string) =>
    request<void>(`/api/tag-boards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  translationStream: async (
    id: string,
    signal: AbortSignal,
    onEvent: (event: TranslationEvent) => void,
  ) => {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(id)}/translations/stream`,
      {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: "text/event-stream",
        },
        signal,
      },
    );
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      throw new Error(`无法订阅译文 (${response.status})`);
    }
    return consumeTranslationStream(response.body, signal, onEvent);
  },
  translations: (id: string) =>
    request<import("@reader/core").TranslationBlock[]>(
      `/api/documents/${id}/translations`,
    ),
  translate: (id: string, blockId = "") =>
    request<{ queued: boolean }>(`/api/documents/${id}/translations`, {
      method: "POST",
      body: JSON.stringify({ blockId }),
    }),
  processing: () => request<Processing[]>("/api/processing"),
  process: (id: string) =>
    request<Processing>(`/api/documents/${id}/processing`, { method: "POST" }),
  blocks: (id: string) => request<PDFBlock[]>(`/api/documents/${id}/blocks`),
  aiConfig: () => request<AIConfig>("/api/ai/config"),
  agentModels: (provider: string, signal?: AbortSignal) =>
    request<AgentModel[]>(
      `/api/ai/models?provider=${encodeURIComponent(provider)}`,
      { signal },
    ),
  saveAIConfig: (config: AIConfig) =>
    request<AIConfig>("/api/ai/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  testAI: (provider: string, capability?: "text" | "vision") =>
    request<AICapability>(
      `/api/ai/test/${provider}${capability ? `?capability=${capability}` : ""}`,
      { method: "POST" },
    ),
  documents: async (): Promise<Document[]> => {
    const { data, error } = await client.GET("/api/documents");
    if (error) throw new Error(error.error);
    return data;
  },
  import: (file: File, library: LibraryMode = "books") => {
    const form = new FormData();
    form.append("library", library);
    form.append("file", file);
    return request<Document>("/api/documents", { method: "POST", body: form });
  },
  removeDocument: (id: string) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  trashDocument: (id: string) =>
    request<Document>(`/api/documents/${encodeURIComponent(id)}/trash`, {
      method: "POST",
    }),
  restoreDocument: (id: string) =>
    request<Document>(`/api/documents/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    }),
  trash: (library: LibraryMode) =>
    request<Document[]>(`/api/trash?library=${library}`),
  emptyTrash: (library: LibraryMode) =>
    request<{ removed: number }>(`/api/trash?library=${library}`, {
      method: "DELETE",
    }),
  classify: (id: string) =>
    request<Document>(`/api/documents/${id}/classification`, {
      method: "POST",
    }),
  update: (
    id: string,
    patch: {
      title?: string;
      author?: string;
      category?: Document["category"];
      tags?: string[];
      favorite?: boolean;
      progress?: DocumentLocation;
      percentage?: number;
      library?: LibraryMode;
      metadata?: Partial<Pick<PaperMetadata, PaperMetadataField>>;
      readingStatus?: ReadingStatus;
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
    request<components["schemas"]["SavedAnnotation"]>(
      `/api/documents/${id}/annotations`,
      {
        method: "POST",
        body: JSON.stringify(annotation),
      },
    ),
  updateAnnotationNote: (id: string, annotation: string, note: string) =>
    request<Annotation>(`/api/documents/${id}/annotations/${annotation}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),
  removeAnnotation: (id: string, annotation: string) =>
    request<void>(`/api/documents/${id}/annotations/${annotation}`, {
      method: "DELETE",
    }),
  search: (id: string, query: string) =>
    request<SearchResult[]>(
      `/api/documents/${id}/search?q=${encodeURIComponent(query)}`,
    ),
  messages: (id: string, signal?: AbortSignal) =>
    request<Message[]>(`/api/documents/${id}/messages`, { signal }),
  providers: (checkAuth = true) =>
    request<Provider[]>(`/api/providers${checkAuth ? "" : "?auth=skip"}`),
  /** Rename a category across a library, or remove it when `to` is omitted. */
  changeLibraryTag: (library: LibraryMode, from: string, to?: string) =>
    request<{ changed: number }>(`/api/libraries/${library}/tags`, {
      method: "POST",
      body: JSON.stringify(to === undefined ? { from } : { from, to }),
    }),
  libraryPreferences: () =>
    request<LibraryPreferences>("/api/preferences/library"),
  saveLibraryPreferences: (preferences: LibraryPreferences) =>
    request<LibraryPreferences>("/api/preferences/library", {
      method: "PUT",
      body: JSON.stringify(preferences),
    }),
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
  onEvent?: (event: ChatStreamEvent) => void,
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
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `AI 请求失败 (${response.status})`);
  }
  if (!response.body) throw new Error("没有收到 AI 输出");
  await consumeChatStream(response.body, signal, (event) => {
    onEvent?.(event);
    if (event.event === "delta") onDelta(event.data.text);
    if (event.event === "fallback") onFallback?.(event.data.message);
  });
}
