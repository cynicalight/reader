import { api, chat, type ChatStreamEvent } from "@reader/api";
import type { ImageAttachment, Message, SourceReference } from "@reader/core";
import { refreshAIConfig } from "../store";
export type ChatInput = {
  provider: string;
  prompt: string;
  context: string;
  references: SourceReference[];
  attachments: ImageAttachment[];
};
export type PendingAnswer = {
  key: string;
  content: string;
  phase:
    | "generating"
    | "syncing"
    | "saved"
    | "incomplete"
    | "unconfirmed"
    | "cancelled";
  notice: string;
  fallback: string;
  before: Set<string>;
  input: ChatInput;
  savedId?: string;
  controller: AbortController;
};
export type ChatSnapshot = {
  messages: Message[];
  messageKeys: Record<string, string>;
  pending?: PendingAnswer;
  archived: PendingAnswer[];
  busy: boolean;
  loaded: boolean;
  loadError?: string;
};
export interface ChatTransport {
  messages: typeof api.messages;
  stream: (
    id: string,
    input: ChatInput,
    signal: AbortSignal,
    emit: (event: ChatStreamEvent) => void,
  ) => Promise<void>;
}
const transport: ChatTransport = {
  messages: api.messages,
  stream: async (id, input, signal, emit) => {
    try {
      await chat(
        id,
        input.provider,
        input.prompt,
        input.context,
        signal,
        () => {},
        input.references,
        input.attachments.map((image) => image.id),
        undefined,
        emit,
      );
    } finally {
      // The server records failed primary attempts even when a fallback succeeds.
      void refreshAIConfig().catch(() => {});
    }
  },
};
/** A per-document store keeps delta renders inside AssistantPanel, outside Workspace. */
export class ChatSession {
  private state: ChatSnapshot = {
    messages: [],
    messageKeys: {},
    archived: [],
    busy: false,
    loaded: false,
  };
  private active?: PendingAnswer;
  private query?: AbortController;
  private listeners = new Set<() => void>();
  private serial = 0;
  private alive = true;
  private frame = 0;
  constructor(
    readonly documentId: string,
    private io = transport,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ChatSnapshot> = {}) {
    this.state = {
      ...this.state,
      ...patch,
      pending: this.active ? { ...this.active } : undefined,
    };
    for (const listener of this.listeners) listener();
  }
  private flush = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.publish();
  };
  activate() {
    this.alive = true;
  }
  private querySignal() {
    this.query?.abort();
    this.query = new AbortController();
    return AbortSignal.any([this.query.signal, AbortSignal.timeout(15_000)]);
  }
  async load() {
    const serial = ++this.serial;
    try {
      const messages = await this.io.messages(
        this.documentId,
        this.querySignal(),
      );
      if (this.alive && serial === this.serial)
        this.publish({ messages, loaded: true, loadError: undefined });
    } catch (error) {
      if (this.alive && serial === this.serial)
        this.publish({ loaded: false, loadError: (error as Error).message });
    }
  }
  dispose() {
    this.alive = false;
    this.serial++;
    this.active?.controller.abort();
    this.query?.abort();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  private current(serial: number) {
    return this.alive && serial === this.serial;
  }
  async send(input: ChatInput) {
    if (!this.alive || this.state.busy) return;
    if (!this.state.loaded)
      throw new Error("对话记录尚未加载，请重试同步后发送。");
    const serial = ++this.serial;
    const controller = new AbortController();
    const pending: PendingAnswer = {
      key: `request-${serial}`,
      content: "",
      phase: "generating",
      notice: "正在阅读上下文…",
      fallback: "",
      before: new Set(this.state.messages.map((message) => message.id)),
      input,
      controller,
    };
    const prior = this.state.pending;
    this.active = pending;
    this.publish({
      pending,
      busy: true,
      archived:
        prior && !prior.savedId
          ? [...this.state.archived, prior]
          : this.state.archived,
    });
    let terminal = false;
    const emit = (event: ChatStreamEvent) => {
      if (!this.current(serial) || controller.signal.aborted || terminal)
        return;
      if (event.event === "delta") {
        pending.content += event.data.text;
        pending.notice = "";
        if (!this.frame) this.frame = requestAnimationFrame(this.flush);
        return;
      }
      if (event.event === "status")
        pending.notice =
          event.data.status === "reading-image"
            ? "正在阅读图片…"
            : "正在阅读上下文…";
      if (event.event === "fallback") pending.fallback = event.data.message;
      if (event.event === "error") {
        terminal = true;
        pending.phase = "incomplete";
        pending.notice = `${event.data.error}（回答未完成）`;
      }
      if (event.event === "done") {
        terminal = true;
        pending.phase = "syncing";
        pending.notice = "回答已保存，正在同步…";
      }
      this.flush();
    };
    try {
      await this.io.stream(this.documentId, input, controller.signal, emit);
      if (!this.current(serial)) return;
      if (!terminal && !controller.signal.aborted) {
        pending.phase = "unconfirmed";
        pending.notice = "完成状态未确认";
      }
    } catch (error) {
      if (!this.current(serial)) return;
      if (!terminal && !controller.signal.aborted) {
        pending.phase = "unconfirmed";
        pending.notice = `${(error as Error).message}；完成状态未确认`;
      }
    } finally {
      if (this.current(serial)) {
        this.flush();
        // Keep the single-request lock until this reconciliation ends. No automatic re-POST.
        await this.reconcile(serial, pending);
        if (this.current(serial)) this.publish({ busy: false });
      }
    }
  }
  cancel() {
    const pending = this.active;
    if (!pending || pending.phase !== "generating") return;
    pending.phase = "cancelled";
    pending.notice = "已停止；正在核对保存状态";
    pending.controller.abort();
    this.flush();
  }
  retry = async () => {
    if (!this.state.loaded) {
      await this.load();
      return;
    }
    if (this.state.busy || !this.active) return;
    const serial = this.serial,
      pending = this.active;
    this.publish({ busy: true });
    await this.reconcile(serial, pending);
    if (this.current(serial)) this.publish({ busy: false });
  };
  private async reconcile(serial: number, pending: PendingAnswer) {
    try {
      const messages = await this.io.messages(
        this.documentId,
        this.querySignal(),
      );
      if (!this.current(serial) || this.active !== pending) return;
      const fresh = messages.filter(
        (message) => !pending.before.has(message.id),
      );
      const users = fresh.filter((message) => message.role === "user");
      const assistants = fresh.filter(
        (message) => message.role === "assistant",
      );
      // IDs from the preflight snapshot and one-user/one-assistant ordering establish
      // the only association available in v1. Content equality alone is insufficient.
      const user = users[0],
        assistant = assistants[0];
      const associated =
        users.length === 1 &&
        assistants.length === 1 &&
        user.content === pending.input.prompt &&
        fresh.indexOf(assistant) > fresh.indexOf(user) &&
        messages.every((message) => message.documentId === this.documentId);
      const messageKeys = { ...this.state.messageKeys };
      if (users.length === 1 && user.content === pending.input.prompt)
        messageKeys[user.id] = `${pending.key}-user`;
      if (associated) {
        messageKeys[assistant.id] = pending.key;
        pending.savedId = assistant.id;
        pending.content = assistant.content;
        pending.phase = "saved";
        pending.notice = "";
      } else {
        pending.notice =
          pending.phase === "syncing"
            ? "回答已保存，记录待同步；请重试同步。"
            : pending.phase === "incomplete"
              ? pending.notice
              : "完成状态未确认；已保留收到的文字，可重试同步。";
      }
      this.publish({ messages, messageKeys });
    } catch {
      if (!this.current(serial)) return;
      pending.notice =
        pending.phase === "syncing"
          ? "回答已保存，同步失败；请重试同步。"
          : "记录同步失败，完成状态未确认；已保留收到的文字。";
      this.publish({ pending: { ...pending } });
    }
  }
}
