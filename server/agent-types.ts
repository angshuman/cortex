import type { ChatEvent, AgentSettings } from "@shared/schema";

export type EventCallback = (event: ChatEvent) => void;

/** Higher-level emit used by the runner functions — handles UUID + persistence internally. */
export type EmitFn = (type: ChatEvent["type"], content: string, metadata?: Record<string, any>) => void;

/**
 * Called by the loop when the model invokes `ask_clarification`.
 * Emits a question event to the UI and awaits the user's response.
 */
export type AskUserFn = (question: string, choices?: string[]) => Promise<string>;

export interface ContextItem {
  type: "note" | "task" | "text" | "file";
  title: string;
  content: string;
  id?: string;
  mimeType?: string;
}

export interface ImageBlock {
  type: "image";
  url: string;       // local URL like /api/chat/assets/xxx.png
  mediaType: string; // e.g. image/png
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextBlock | ImageBlock;

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export const defaultAgentSettings: AgentSettings = {
  maxTurns: 200,  // Safety cap only — agent stops naturally when LLM stops calling tools
  maxTokens: 16384,
  temperature: 0.7,
  fetchTimeout: 30000,
  fetchMaxLength: 50000,
  systemPromptSuffix: "",
};
