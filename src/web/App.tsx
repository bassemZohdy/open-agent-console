import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
  ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type {
  AppendMessage,
  TextMessagePartProps,
  ThreadMessageLike,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { parseSseBuffer } from "./sse";

type Provider =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "ollama"
  | "fake";
type Model = {
  id: string;
  name: string;
  provider: Provider;
  modelId: string;
  baseUrl?: string | null;
  apiKeyEnv: string;
  enabled: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  capabilities: string[];
  timeoutMs: number;
  maxRetries: number;
};
type Skill = {
  id: string;
  name: string;
  description?: string | null;
  instructions: string;
  enabled: boolean;
};
type Tool = {
  id: string;
  name: string;
  description: string;
  kind: string;
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  mcpServerId?: string | null;
  externalName?: string | null;
  enabled: boolean;
};
type McpServer = {
  id: string;
  name: string;
  url: string;
  headers: Record<string, unknown>;
  enabled: boolean;
};
type MemoryConnector = {
  id: string;
  name: string;
  type: "none" | "sqlite";
  config: Record<string, unknown>;
  enabled: boolean;
};
type Agent = {
  id: string;
  name: string;
  description?: string | null;
  modelRef: string;
  memoryConnectorId?: string | null;
  accessLevel?: AgentAccessLevel;
  instructions: string;
  enabled: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  maxModelCalls: number;
  maxToolCalls: number;
  skillIds: string[];
  toolIds: string[];
};
type AgentAccessLevel = "admin" | "user" | "guest";
type A2aExposure = {
  id: string;
  agentId: string;
  slug: string;
  published: boolean;
  enabled: boolean;
  visibility: "private" | "internal" | "public";
  authMode: "bearer" | "none";
  authEnv?: string | null;
  streaming: boolean;
  maxTaskSeconds: number;
  maxRequestsPerMinute: number;
  maxConcurrentTasks: number;
  status: "draft" | "paused" | "published" | "unavailable";
  transportReady: boolean;
  agent?: Pick<Agent, "id" | "name" | "description" | "accessLevel" | "enabled">;
};
type Memory = {
  id: string;
  agentId: string;
  connectorId: string;
  key?: string | null;
  content: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};
type Session = {
  id: string;
  agentId: string;
  title?: string | null;
  updatedAt: string;
};
type Run = {
  id: string;
  agentId: string;
  sessionId: string;
  status: string;
  startedAt: string;
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  correlationId?: string | null;
  completedAt?: string | null;
  contextTruncated?: boolean;
  durationMs?: number | null;
};
type RunDetail = Run & {
  toolCalls: Array<{
    id: string;
    toolName: string;
    status: string;
    inputJson: string;
    output?: string | null;
    error?: string | null;
    startedAt: string;
    completedAt?: string | null;
  }>;
};
type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  attachments?: ChatAttachment[];
};
type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  text?: string;
};
type PageResponse<T> = { items: T[]; offset: number; limit: number };
type SelectOption = { value: string; label: string; searchText?: string };
type Page =
  | "chat"
  | "dashboard"
  | "models"
  | "agents"
  | "skills"
  | "tools"
  | "mcp"
  | "memory"
  | "sessions"
  | "runs"
  | "settings";
type AccessRole = "admin" | "user" | "guest";
type Theme = "dark" | "light";
type NavIconName =
  | "add"
  | "arrow-down"
  | "arrow-up"
  | "chat"
  | "check"
  | "close"
  | "collapse"
  | "copy"
  | "dashboard"
  | "discover"
  | "download"
  | "edit"
  | "eye"
  | "eye-off"
  | "inspect"
  | "log-in"
  | "log-out"
  | "models"
  | "agents"
  | "skills"
  | "tools"
  | "mcp"
  | "memory"
  | "mic"
  | "moon"
  | "open"
  | "paperclip"
  | "play"
  | "power"
  | "search"
  | "sessions"
  | "runs"
  | "save"
  | "send"
  | "settings"
  | "stop"
  | "sun"
  | "trash"
  | "upload";
type AuthState = {
  authenticated: boolean;
  username?: string;
  role?: AccessRole;
  capabilities?: string[];
};
type ConfirmState = {
  title: string;
  message: string;
  action: () => Promise<void>;
} | null;

function submitMessageOnEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function appendMessageText(message: AppendMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

const nav: Array<[Page, string, string, NavIconName]> = [
  ["chat", "Chat", "Conversation workspace", "chat"],
  ["dashboard", "Dashboard", "Overview", "dashboard"],
  ["models", "Models", "Providers", "models"],
  ["agents", "Agents", "Runtime instances", "agents"],
  ["skills", "Skills", "Prompt modules", "skills"],
  ["tools", "Tools", "Actions", "tools"],
  ["mcp", "MCP servers", "Remote tools", "mcp"],
  ["memory", "Memory", "Long-term context", "memory"],
  ["sessions", "Conversations", "All conversations", "sessions"],
  ["runs", "Runs", "Execution log", "runs"],
  ["settings", "Settings", "Operations", "settings"],
];
const primaryNav = nav.filter(([key]) =>
  ["chat", "dashboard"].includes(key),
);
const settingsNav = nav.filter(([key]) =>
  ["settings", "models", "agents", "skills", "tools", "mcp", "memory"].includes(key),
);
const adminPages = new Set<Page>([
  "models",
  "agents",
  "skills",
  "tools",
  "mcp",
  "memory",
]);
const capabilities = [
  "streaming",
  "tools",
  "vision",
  "audio",
  "structured-output",
];
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const themeStorageKey = "open-agent-console-theme";
const maxChatAttachmentBytes = 8 * 1024 * 1024;
const maxChatAttachmentText = 60_000;

function createLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isTextAttachment(file: File): boolean {
  return file.type.startsWith("text/") || /\.(csv|css|html?|js|json|md|py|tsx?|txt|xml|yaml|yml)$/i.test(file.name);
}

async function readChatAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > maxChatAttachmentBytes) {
    throw new Error(`${file.name} is larger than 8 MB.`);
  }
  let text: string | undefined;
  if (isTextAttachment(file)) {
    const rawText = await file.text();
    text = rawText.length > maxChatAttachmentText
      ? `${rawText.slice(0, maxChatAttachmentText - 32)}\n[Attachment text truncated.]`
      : rawText;
  }
  return {
    id: createLocalId(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    text,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return stored === "light" || stored === "dark" ? stored : "dark";
  } catch {
    return "dark";
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      payload.error ?? `Request failed: ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function optionalNumber(data: FormData, name: string): number | undefined {
  const value = String(data.get(name) ?? "").trim();
  return value ? Number(value) : undefined;
}
function requiredNumber(
  data: FormData,
  name: string,
  fallback: number,
): number {
  return optionalNumber(data, name) ?? fallback;
}
function jsonText(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}
function parseJsonText(
  value: FormDataEntryValue | null,
  label: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a JSON object`);
  }
}
function formatDate(value: string): string {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [role, setRole] = useState<AccessRole>("user");
  const [auth, setAuth] = useState<AuthState>();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [connectors, setConnectors] = useState<MemoryConnector[]>([]);
  const [a2aExposures, setA2aExposures] = useState<A2aExposure[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [sessionRuns, setSessionRuns] = useState<Run[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [editingMcp, setEditingMcp] = useState<McpServer | null>(null);
  const [editingConnector, setEditingConnector] =
    useState<MemoryConnector | null>(null);
  const [editingA2a, setEditingA2a] = useState<A2aExposure | null>(null);
  const [a2aFormOpen, setA2aFormOpen] = useState(false);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [chatInitialText, setChatInitialText] = useState("");
  const [chatInitialAttachments, setChatInitialAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>();
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [draftToolIds, setDraftToolIds] = useState<string[]>([]);
  const [selectedMemoryAgent, setSelectedMemoryAgent] = useState<string>("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryConnector, setMemoryConnector] =
    useState<MemoryConnector | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [promptPreview, setPromptPreview] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const abortRef = useRef<AbortController | null>(null);
  const defaultChatAgent = agents.find((agent) => agent.enabled) ?? null;

  const refresh = async () => {
    setLoading(true);
    try {
      const authResult = await json<AuthState>("/api/auth/me");
      setAuth(authResult);
      if (authResult.authenticated === false) {
        setRole("guest");
        const [agentRows, sessionPage, runPage] = await Promise.all([
          json<Agent[]>("/api/agents"),
          json<PageResponse<Session>>("/api/sessions?limit=100"),
          json<PageResponse<Run>>("/api/runs?limit=100"),
        ]);
        setModels([]);
        setAgents(agentRows);
        setSkills([]);
        setTools([]);
        setMcpServers([]);
        setConnectors([]);
        setA2aExposures([]);
        setSessions(sessionPage.items);
        setRuns(runPage.items);
        return;
      }
      const [
        modelRows,
        agentRows,
        skillRows,
        toolRows,
        mcpRows,
        connectorRows,
        sessionPage,
        runPage,
      ] = await Promise.all([
        json<Model[]>("/api/models"),
        json<Agent[]>("/api/agents"),
        json<Skill[]>("/api/skills"),
        json<Tool[]>("/api/tools"),
        json<McpServer[]>("/api/mcp-servers"),
        json<MemoryConnector[]>("/api/memory-connectors"),
        json<PageResponse<Session>>("/api/sessions?limit=100"),
        json<PageResponse<Run>>("/api/runs?limit=100"),
      ]);
      setRole(
        authResult.role === "guest" || authResult.role === "user"
          ? authResult.role
          : "admin",
      );
      setModels(modelRows);
      setAgents(agentRows);
      setSkills(skillRows);
      setTools(toolRows);
      setMcpServers(mcpRows);
      setConnectors(connectorRows);
      setA2aExposures(
        authResult.role === "admin"
          ? await json<A2aExposure[]>("/api/a2a/exposures")
          : [],
      );
      setSessions(sessionPage.items);
      setRuns(runPage.items);
    } finally {
      setLoading(false);
    }
  };
  const expireAuth = (cause: unknown): boolean => {
    if (!(cause instanceof ApiError) || cause.status !== 401) return false;
    setAuth({ authenticated: false });
    setRole("guest");
    setPage("chat");
    setChatAgent(null);
    setLoginOpen(true);
    setNotice("Your session expired. Sign in again to continue.");
    void refresh().catch(() => undefined);
    return true;
  };
  const login = async (username: string, password: string) => {
    await json<AuthState>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    setNotice(undefined);
    setError(undefined);
    setLoginOpen(false);
    await refresh();
  };
  const logout = async () => {
    await json("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    abortRef.current?.abort();
    setAuth({ authenticated: false });
    setRole("guest");
    setPage("chat");
    setChatAgent(null);
    setMessages([]);
    setSessionId(undefined);
    setChatInitialAttachments([]);
    setNotice("Signed out. Guest access is active.");
    await refresh();
  };
  useEffect(() => {
    void refresh().catch((e: unknown) => {
      if (expireAuth(e)) return;
      setError(e instanceof Error ? e.message : "Unable to load the console");
    });
  }, []);
  useEffect(() => {
    if (!auth) return;
    if (role !== "admin" && (page === "dashboard" || adminPages.has(page))) {
      setPage("chat");
    }
  }, [auth, page, role]);
  useEffect(() => {
    document.title =
      `${nav.find(([key]) => key === page)?.[1] ?? "Console"} · Open Agent Console`;
  }, [auth?.authenticated, page]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Private browsing and locked-down environments can reject local storage.
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#071014" : "#f4f7f6");
  }, [theme]);
  useEffect(() => {
    if (!selectedMemoryAgent && agents[0]) setSelectedMemoryAgent(agents[0].id);
  }, [agents, selectedMemoryAgent]);
  useEffect(() => {
    if (role === "guest" || !selectedMemoryAgent) return;
    void json<{ connector: MemoryConnector | null; items: Memory[] }>(
      `/api/agents/${selectedMemoryAgent}/memories`,
    )
      .then((result) => {
        setMemoryConnector(result.connector);
        setMemories(result.items);
      })
      .catch((e: unknown) => {
        if (!expireAuth(e)) setError(e instanceof Error ? e.message : "Request failed");
      });
  }, [selectedMemoryAgent, agents, role]);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const visibleSessions = useMemo(() => {
    const query = sessionSearch.trim().toLocaleLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const title = session.title || "Untitled session";
      const agent = agentNames.get(session.agentId) ?? "";
      return `${title} ${agent}`.toLocaleLowerCase().includes(query);
    });
  }, [agentNames, sessionSearch, sessions]);
  const latestErrors = useMemo(
    () => runs.filter((run) => run.status === "failed").slice(0, 5),
    [runs],
  );
  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setError(undefined);
    try {
      await action();
      return true;
    } catch (e) {
      if (!expireAuth(e)) setError(e instanceof Error ? e.message : "Request failed");
      return false;
    }
  };
  const requestDelete = (
    title: string,
    message: string,
    action: () => Promise<void>,
  ) => setConfirm({ title, message, action });
  const openNewAgent = () => {
    setEditingAgent(null);
    setDraftSkillIds([]);
    setDraftToolIds([]);
    setPromptPreview(undefined);
  };
  const openAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setDraftSkillIds(agent.skillIds);
    setDraftToolIds(agent.toolIds);
    setPromptPreview(undefined);
  };

  async function saveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? ""),
      provider: String(data.get("provider") ?? "openai"),
      modelId: String(data.get("modelId") ?? ""),
      baseUrl: String(data.get("baseUrl") ?? ""),
      apiKeyEnv: String(data.get("apiKeyEnv") ?? ""),
      temperature: optionalNumber(data, "temperature"),
      maxTokens: optionalNumber(data, "maxTokens"),
      capabilities: data.getAll("capabilities").map(String),
      timeoutMs: requiredNumber(data, "timeoutMs", 60000),
      maxRetries: requiredNumber(data, "maxRetries", 2),
    };
    await json(
      editingModel ? `/api/models/${editingModel.id}` : "/api/models",
      {
        method: editingModel ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingModel(null);
    setNotice(editingModel ? "Model updated." : "Model added.");
    await refresh();
  }
  async function saveAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      modelRef: String(data.get("modelRef") ?? ""),
      memoryConnectorId: String(data.get("memoryConnectorId") ?? "") || null,
      accessLevel: String(data.get("accessLevel") ?? "user") as AgentAccessLevel,
      instructions: String(data.get("instructions") ?? ""),
      temperature: optionalNumber(data, "temperature"),
      maxTokens: optionalNumber(data, "maxTokens"),
      maxModelCalls: requiredNumber(data, "maxModelCalls", 6),
      maxToolCalls: requiredNumber(data, "maxToolCalls", 10),
      skillIds: draftSkillIds,
      toolIds: draftToolIds,
    };
    await json(
      editingAgent ? `/api/agents/${editingAgent.id}` : "/api/agents",
      {
        method: editingAgent ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingAgent(null);
    setNotice(
      editingAgent
        ? "Agent updated; runtime cache invalidated."
        : "Agent created.",
    );
    await refresh();
  }
  async function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      instructions: String(data.get("instructions") ?? ""),
      enabled: data.get("enabled") === "on",
    };
    await json(
      editingSkill ? `/api/skills/${editingSkill.id}` : "/api/skills",
      {
        method: editingSkill ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingSkill(null);
    setNotice(editingSkill ? "Skill updated." : "Skill added.");
    await refresh();
  }
  async function saveTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = String(data.get("kind") ?? "builtin-calculator");
    const body = {
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      kind,
      config: parseJsonText(data.get("config"), "Configuration"),
      inputSchema: parseJsonText(data.get("inputSchema"), "Input schema"),
      mcpServerId:
        kind === "mcp" ? String(data.get("mcpServerId") ?? "") || null : null,
      externalName:
        kind === "mcp" ? String(data.get("externalName") ?? "") || null : null,
      enabled: data.get("enabled") === "on",
    };
    if (data.get("intent") === "validate") {
      await json<{ valid: boolean }>('/api/tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNotice('Tool configuration is valid.');
      return;
    }
    await json(editingTool ? `/api/tools/${editingTool.id}` : "/api/tools", {
      method: editingTool ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditingTool(null);
    setNotice(editingTool ? "Tool updated." : "Tool added.");
    await refresh();
  }
  async function saveMcp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? ""),
      url: String(data.get("url") ?? ""),
      headers: parseJsonText(data.get("headers"), "Headers"),
      enabled: data.get("enabled") === "on",
    };
    await json(
      editingMcp ? `/api/mcp-servers/${editingMcp.id}` : "/api/mcp-servers",
      {
        method: editingMcp ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingMcp(null);
    setNotice(editingMcp ? "MCP server updated." : "MCP server added.");
    await refresh();
  }
  async function saveConnector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? ""),
      type: String(data.get("type") ?? "sqlite"),
      config: {},
      enabled: data.get("enabled") === "on",
    };
    await json(
      editingConnector
        ? `/api/memory-connectors/${editingConnector.id}`
        : "/api/memory-connectors",
      {
        method: editingConnector ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingConnector(null);
    setNotice(
      editingConnector
        ? "Memory connector updated."
        : "Memory connector added.",
    );
    await refresh();
  }
  async function saveA2a(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      agentId: String(data.get("agentId") ?? ""),
      slug: String(data.get("slug") ?? "").trim().toLowerCase(),
      published: data.get("published") === "on",
      enabled: data.get("enabled") === "on",
      visibility: String(data.get("visibility") ?? "private"),
      authMode: String(data.get("authMode") ?? "bearer"),
      authEnv: String(data.get("authEnv") ?? "").trim(),
      streaming: data.get("streaming") === "on",
      maxTaskSeconds: requiredNumber(data, "maxTaskSeconds", 300),
      maxRequestsPerMinute: requiredNumber(data, "maxRequestsPerMinute", 60),
      maxConcurrentTasks: requiredNumber(data, "maxConcurrentTasks", 4),
    };
    await json(
      editingA2a ? `/api/a2a/exposures/${editingA2a.id}` : "/api/a2a/exposures",
      {
        method: editingA2a ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingA2a(null);
    setA2aFormOpen(false);
    setNotice(editingA2a ? "A2A exposure updated." : "A2A exposure created.");
    await refresh();
  }
  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      key: String(data.get("key") ?? ""),
      content: String(data.get("content") ?? ""),
      metadata: parseJsonText(data.get("metadata"), "Metadata"),
    };
    await json(
      editingMemory
        ? `/api/agents/${selectedMemoryAgent}/memories/${editingMemory.id}`
        : `/api/agents/${selectedMemoryAgent}/memories`,
      {
        method: editingMemory ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setEditingMemory(null);
    setNotice(editingMemory ? "Memory updated." : "Memory added.");
    const result = await json<{
      connector: MemoryConnector | null;
      items: Memory[];
    }>(`/api/agents/${selectedMemoryAgent}/memories`);
    setMemoryConnector(result.connector);
    setMemories(result.items);
  }
  async function previewPrompt() {
    if (!editingAgent) return;
    const result = await json<{ prompt: string }>(
      `/api/agents/${editingAgent.id}/effective-prompt`,
    );
    setPromptPreview(result.prompt);
  }
  async function testModel(model: Model) {
    setNotice(`Testing ${model.name}…`);
    await run(async () => {
      const result = await json<{ latencyMs: number }>(
        `/api/models/${model.id}/test`,
        { method: "POST" },
      );
      setNotice(`${model.name} responded in ${result.latencyMs} ms.`);
    });
  }
  async function discover(server: McpServer) {
    setNotice(`Discovering tools from ${server.name}…`);
    await run(async () => {
      const result = await json<{
        tools: Array<{ name: string; description: string }>;
      }>(`/api/mcp-servers/${server.id}/discover`, { method: "POST" });
      setNotice(
        `${result.tools.length} tool${result.tools.length === 1 ? "" : "s"} discovered.`,
      );
    });
  }
  async function exportRegistry() {
    const response = await fetch("/api/registry/export");
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "open-agent-console-registry.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice("Registry export downloaded without secrets or memories.");
  }
  async function importRegistry(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    await run(async () => {
      await json("/api/registry/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: content,
      });
      setNotice(
        "Registry imported. Existing records with matching IDs were updated.",
      );
      await refresh();
    });
    event.target.value = "";
  }
  function startNewChat(agent: Agent, initialText = "", initialAttachments: ChatAttachment[] = []) {
    setPage("chat");
    setChatAgent(agent);
    setMessages([]);
    setSessionId(undefined);
    setSessionRuns([]);
    setChatInitialText(initialText);
    setChatInitialAttachments(initialAttachments);
    setUsage(undefined);
    setError(undefined);
  }
  async function reopenSession(session: Session) {
    await run(async () => {
      const agent = agents.find(
        (candidate) => candidate.id === session.agentId,
      );
      if (!agent)
        throw new Error("The agent for this session no longer exists.");
      const [stored, activity] = await Promise.all([
        json<Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
          attachments?: Array<{ name: string; mimeType: string; size: number }>;
        }>>(
          `/api/sessions/${session.id}/messages`,
        ),
        json<PageResponse<Run>>(
          `/api/runs?sessionId=${encodeURIComponent(session.id)}&limit=100`,
        ),
      ]);
      setMessages(
        stored
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message) => ({
            id: message.id,
            role: message.role as Message["role"],
            content: message.content,
            createdAt: message.createdAt,
            attachments: message.attachments?.map((attachment) => ({
              ...attachment,
              id: createLocalId(),
            })),
          })),
      );
      setSessionId(session.id);
      setChatInitialText("");
      setSessionRuns(activity.items);
      setChatAgent(agent);
      setUsage(undefined);
      setPage("chat");
    });
  }
  async function renameSession(title: string) {
    if (!editingSession) return;
    await json(`/api/sessions/${editingSession.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setEditingSession(null);
    setNotice("Session renamed.");
    await refresh();
  }
  function closeChat() {
    abortRef.current?.abort();
    setChatAgent(null);
    setMessages([]);
    setSessionId(undefined);
    setChatInitialText("");
    setChatInitialAttachments([]);
    setSessionRuns([]);
    setUsage(undefined);
    setBusy(false);
    setPage(role === "admin" ? "dashboard" : "chat");
  }
  async function sendMessage(rawText: string, attachments: ChatAttachment[] = []) {
    if (!chatAgent || !rawText.trim() || busy) return;
    const text = rawText.trim();
    let activeSessionId = sessionId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(undefined);
    setUsage(undefined);
    setMessages((current) => [
      ...current,
      {
        id: createLocalId(),
        role: "user",
        content: text,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
      { id: createLocalId(), role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch(`/api/agents/${chatAgent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          sessionId,
          attachments: attachments.map(({ name, mimeType, size, text: attachmentText }) => ({
            name,
            mimeType,
            size,
            text: attachmentText,
          })),
        }),
      });
      if (!response.ok || !response.body)
        throw new ApiError(`Chat request failed: ${response.status}`, response.status);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);
        buffer = parsed.rest;
        for (const payload of parsed.events) {
          if (payload.type === "session") {
            activeSessionId = payload.sessionId;
            setSessionId(payload.sessionId);
          }
          if (payload.type === "token")
            setMessages((current) =>
              current.map((message, index) =>
                index === current.length - 1
                  ? { ...message, content: message.content + payload.text }
                  : message,
              ),
            );
          if (payload.type === "usage") setUsage(payload);
          if (payload.type === "error") throw new Error(payload.message);
        }
      }
      await refresh();
      if (activeSessionId) {
        const activity = await json<PageResponse<Run>>(
          `/api/runs?sessionId=${encodeURIComponent(activeSessionId)}&limit=100`,
        );
        setSessionRuns(activity.items);
      }
    } catch (e) {
      if (controller.signal.aborted)
        setMessages((current) =>
          current.map((message, index) =>
            index === current.length - 1 && !message.content
              ? { ...message, content: "_Response cancelled._" }
              : message,
          ),
        );
      else if (!expireAuth(e)) setError(e instanceof Error ? e.message : "Chat failed");
      await refresh().catch(() => undefined);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  const deleteById = async (kind: string, id: string): Promise<void> => {
    await run(async () => {
      await json(`/api/${kind}/${id}`, { method: "DELETE" });
      setNotice("Deleted.");
      await refresh();
    });
  };
  const deleteSession = async (session: Session): Promise<void> => {
    await json(`/api/sessions/${session.id}`, { method: "DELETE" });
    if (sessionId === session.id) {
      abortRef.current?.abort();
      setChatAgent(null);
      setMessages([]);
      setSessionId(undefined);
      setSessionRuns([]);
      setUsage(undefined);
      setChatInitialText("");
      setChatInitialAttachments([]);
    }
    setNotice("Conversation deleted.");
    await refresh();
  };
  const pageLabel = nav.find(([key]) => key === page)?.[1] ?? "Chat";
  const visiblePrimaryNav =
    role === "admin"
      ? primaryNav
      : primaryNav.filter(([key]) => key === "chat");
  if (!auth) {
    return <AuthLoading theme={theme} onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} />;
  }
  const isAuthenticated = auth.authenticated !== false;
  return (
    <div className={`shell${sidebarCollapsed ? " sidebar-is-collapsed" : ""}${page === "chat" ? " chat-page" : ""}`}>
      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-lockup">
            <div className="logo" aria-hidden="true">
              OA
            </div>
            <div className="brand-copy">
              <strong>Open Agent</strong>
              <span>Console</span>
            </div>
          </div>
          <IconButton
            className="sidebar-toggle"
            icon="collapse"
            label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            ariaPressed={sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}
          />
        </div>
        <button
          type="button"
          className="new-chat-button"
          disabled={!defaultChatAgent}
          aria-label={defaultChatAgent ? "Start a new chat" : "No enabled agents available"}
          title={defaultChatAgent ? "Start a new chat" : "No enabled agents available"}
          data-tooltip={defaultChatAgent ? "New chat" : "No enabled agents"}
          onClick={() => {
            if (defaultChatAgent) startNewChat(defaultChatAgent);
          }}
        >
          <span className="new-chat-plus new-chat-plus-default" aria-hidden="true"><NavIcon name="add" /></span>
          <span className="new-chat-plus new-chat-plus-collapsed" aria-hidden="true"><NavIcon name="edit" /></span>
          <span className="new-chat-copy">New chat</span>
        </button>
        <p id="sidebar-chat-hint" className="new-chat-hint">
          {defaultChatAgent ? "Open an enabled agent and start writing." : "Enable an agent to start a chat."}
        </p>
        <nav aria-label="Primary navigation">
          {visiblePrimaryNav.map(([key, label, detail, icon]) => (
            <button
              type="button"
              className={page === key ? "active" : ""}
              aria-label={`${label}: ${detail}`}
              title={label}
              data-tooltip={label}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
              key={key}
            >
              <NavIcon name={icon} />
              <span className="nav-item-copy">
                <span>{label}</span>
                <small>{detail}</small>
              </span>
            </button>
          ))}
          {role !== "guest" && (
            <div className="nav-group">
              <span className="nav-group-label">
                {role === "admin" ? "Settings & configuration" : "Workspace"}
              </span>
              {(role === "admin"
                ? settingsNav
                : settingsNav.filter(([key]) => key === "settings")
              ).map(([key, label, detail, icon]) => (
                <button
                  type="button"
                  className={page === key ? "active" : ""}
                  aria-label={`${label}: ${detail}`}
                  title={label}
                  data-tooltip={label}
                  aria-current={page === key ? "page" : undefined}
                  onClick={() => setPage(key)}
                  key={key}
                >
                  <NavIcon name={icon} />
                  <span className="nav-item-copy">
                    <span>{label}</span>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <section className="sidebar-history" aria-label="Conversations">
          <div className="sidebar-history-heading">
            <span>Conversations</span>
            <span className="sidebar-history-count">{sessions.length}</span>
          </div>
          {sessions.length > 5 && (
            <label className="sidebar-search" htmlFor="sidebar-session-search">
              <NavIcon name="search" />
              <span className="sr-only">Search conversations</span>
              <input
                id="sidebar-session-search"
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
                placeholder="Search conversations"
              />
              {sessionSearch && (
                <IconButton
                  icon="close"
                  className="sidebar-search-clear"
                  label="Clear conversation search"
                  onClick={() => setSessionSearch("")}
                />
              )}
            </label>
          )}
          <div className="sidebar-history-list">
            {visibleSessions.length === 0 ? (
              <p className="sidebar-history-empty">
                {sessions.length === 0 ? "Your conversations will appear here." : "No matching conversations."}
              </p>
            ) : (
              visibleSessions.map((session) => (
                <div
                  className={`sidebar-history-item${sessionId === session.id ? " active" : ""}`}
                  key={session.id}
                >
                  <button
                    type="button"
                    className="sidebar-history-open"
                    onClick={() => void reopenSession(session)}
                  >
                    <span className="sidebar-session-icon" aria-hidden="true">
                      <NavIcon name="sessions" />
                    </span>
                    <span className="sidebar-session-copy">
                      <span>{session.title || "Untitled session"}</span>
                      <small>{agentNames.get(session.agentId) ?? "Agent"}</small>
                    </span>
                  </button>
                  <IconButton
                    icon="trash"
                    className="sidebar-history-delete danger"
                    label={`Delete ${session.title || "conversation"}`}
                    onClick={() =>
                      requestDelete(
                        "Delete conversation",
                        `Delete “${session.title || "Untitled conversation"}”? Its messages and run history will also be deleted.`,
                        () => deleteSession(session),
                      )
                    }
                  />
                </div>
              ))
            )}
          </div>
          {sessions.length > 0 && (
            <ActionButton
              icon="open"
              variant="quiet"
              compact
              className="sidebar-history-all"
              onClick={() => setPage("sessions")}
            >
              View all conversations
            </ActionButton>
          )}
        </section>
        <div className="sidebar-foot">
          Single runtime · SQLite · LangChain
          <span>v{appVersion} · Ready for local control</span>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">SELF-CONTAINED AGENT RUNTIME</p>
            <h1>{pageLabel}</h1>
          </div>
          <div className="header-actions">
            <span className={`role-badge ${role}`} aria-label={`Current role: ${role}`}>
              <i /> {role === "admin" ? "Admin" : role === "user" ? "User" : "Guest"}
            </span>
            {isAuthenticated ? (
              <>
                <span className="account-label">{auth.username}</span>
                <ActionButton
                  icon="log-out"
                  variant="secondary"
                  compact
                  className="sign-out"
                  onClick={() => void logout().catch((e: Error) => setError(e.message))}
                >
                  Sign out
                </ActionButton>
              </>
            ) : (
              <>
                <span className="guest-preview-label">Guest preview · allowed agents only</span>
                <ActionButton
                  icon="log-in"
                  variant="primary"
                  compact
                  className="sign-in-trigger"
                  onClick={() => setLoginOpen(true)}
                >
                  Sign in
                </ActionButton>
              </>
            )}
            <ThemeControl
              theme={theme}
              onToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            />
            <div className="status">
              <i /> Runtime ready
            </div>
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <IconButton icon="close" className="banner-dismiss" label="Dismiss error" onClick={() => setError(undefined)} />
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            <span>{notice}</span>
            <IconButton icon="close" className="banner-dismiss" label="Dismiss notice" onClick={() => setNotice(undefined)} />
          </div>
        )}
        {loading ? (
          <div className="panel loading-state" role="status">
            <span className="spinner" />
            Loading registry…
          </div>
        ) : (
          <>
            {role === "admin" && page === "dashboard" && (
              <Dashboard
                role={role}
                agents={agents}
                models={models}
                skills={skills}
                tools={tools}
                connectors={connectors}
                sessions={sessions}
                latestErrors={latestErrors}
                onPage={setPage}
                onSettings={(section) => setPage(section)}
                onChat={startNewChat}
                onSession={(session) => void reopenSession(session)}
              />
            )}
            {page === "chat" && (
              <ChatWorkspace
                agent={chatAgent}
                agents={agents.filter((agent) => agent.enabled)}
                messages={messages}
                activity={sessionRuns}
                sessionId={sessionId}
                initialText={chatInitialText}
                initialAttachments={chatInitialAttachments}
                busy={busy}
                usage={usage}
                onChat={startNewChat}
                onClose={closeChat}
                onCancel={() => abortRef.current?.abort()}
                onSend={sendMessage}
              />
            )}
            {role === "admin" && page === "models" && (
              <ModelsPage
                models={models}
                editing={editingModel}
                onEdit={setEditingModel}
                onDelete={(model) =>
                  requestDelete(
                    "Delete model",
                    `Delete “${model.name}”? Referenced models are protected.`,
                    () => deleteById("models", model.id),
                  )
                }
                onTest={(model) => void testModel(model)}
                onSubmit={(event) => run(() => saveModel(event))}
              />
            )}
            {role === "admin" && page === "agents" && (
              <AgentsPage
                agents={agents}
                models={models}
                skills={skills}
                tools={tools}
                connectors={connectors}
                editing={editingAgent}
                draftSkillIds={draftSkillIds}
                draftToolIds={draftToolIds}
                promptPreview={promptPreview}
                onNew={openNewAgent}
                onEdit={openAgent}
                onDraftSkills={setDraftSkillIds}
                onDraftTools={setDraftToolIds}
                onPreview={() => void run(previewPrompt)}
                onDelete={(agent) =>
                  requestDelete(
                    "Delete agent",
                    `Delete “${agent.name}”? Its sessions, messages, and run history will also be deleted.`,
                    () => deleteById("agents", agent.id),
                  )
                }
                onDuplicate={(agent) =>
                  void run(async () => {
                    await json(`/api/agents/${agent.id}/duplicate`, {
                      method: "POST",
                    });
                    setNotice("Agent duplicated and disabled by default.");
                    await refresh();
                  })
                }
                onEnabled={(agent) =>
                  void run(async () => {
                    await json(`/api/agents/${agent.id}/enabled`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ enabled: !agent.enabled }),
                    });
                    await refresh();
                  })
                }
                onChat={startNewChat}
                onSubmit={(event) => run(() => saveAgent(event))}
              />
            )}
            {role === "admin" && page === "skills" && (
              <SkillsPage
                skills={skills}
                editing={editingSkill}
                onEdit={setEditingSkill}
                onDelete={(skill) =>
                  requestDelete("Delete skill", `Delete “${skill.name}”?`, () =>
                    deleteById("skills", skill.id),
                  )
                }
                onSubmit={(event) => run(() => saveSkill(event))}
              />
            )}
            {role === "admin" && page === "tools" && (
              <ToolsPage
                tools={tools}
                mcpServers={mcpServers}
                editing={editingTool}
                onEdit={setEditingTool}
                onDelete={(tool) =>
                  requestDelete(
                    "Delete tool",
                    `Delete “${tool.name}”? Mapped tools are protected.`,
                    () => deleteById("tools", tool.id),
                  )
                }
                onSubmit={(event) => run(() => saveTool(event))}
              />
            )}
            {role === "admin" && page === "mcp" && (
              <McpPage
                servers={mcpServers}
                editing={editingMcp}
                onEdit={setEditingMcp}
                onDelete={(server) =>
                  requestDelete(
                    "Delete MCP server",
                    `Delete “${server.name}”?`,
                    () => deleteById("mcp-servers", server.id),
                  )
                }
                onDiscover={(server) => void discover(server)}
                onSubmit={(event) => run(() => saveMcp(event))}
              />
            )}
            {role === "admin" && page === "memory" && (
              <MemoryPage
                agents={agents}
                connectors={connectors}
                selectedAgent={selectedMemoryAgent}
                connector={memoryConnector}
                memories={memories}
                editingConnector={editingConnector}
                editingMemory={editingMemory}
                onAgent={setSelectedMemoryAgent}
                onEditConnector={setEditingConnector}
                onDeleteConnector={(connector) =>
                  requestDelete(
                    "Delete memory connector",
                    `Delete “${connector.name}”?`,
                    () => deleteById("memory-connectors", connector.id),
                  )
                }
                onEditMemory={setEditingMemory}
                onDeleteMemory={(memory) =>
                  requestDelete(
                    "Delete memory",
                    `Delete this saved memory?`,
                    async () => {
                      await run(async () => {
                        await json(
                          `/api/agents/${selectedMemoryAgent}/memories/${memory.id}`,
                          { method: "DELETE" },
                        );
                        setMemories((rows) =>
                          rows.filter((row) => row.id !== memory.id),
                        );
                        setNotice("Memory deleted.");
                      });
                    },
                  )
                }
                onConnectorSubmit={(event) =>
                  run(() => saveConnector(event))
                }
                onMemorySubmit={(event) => run(() => saveMemory(event))}
              />
            )}
            {page === "sessions" && (
              <SessionsPage
                sessions={sessions}
                agents={agentNames}
                onOpen={(session) => void reopenSession(session)}
                onRename={setEditingSession}
                onDelete={(session) =>
                  requestDelete(
                    "Delete session",
                    `Delete “${session.title || "Untitled session"}”? Its messages and run history will also be deleted.`,
                    () => deleteSession(session),
                  )
                }
              />
            )}
            {page === "settings" && (
              <SettingsPage
                role={role}
                agents={agents}
                a2aExposures={a2aExposures}
                editingA2a={editingA2a}
                a2aFormOpen={a2aFormOpen}
                onExport={() => void run(exportRegistry)}
                onImport={importRegistry}
                onNewA2a={() => {
                  setEditingA2a(null);
                  setA2aFormOpen(true);
                }}
                onEditA2a={(exposure) => {
                  setEditingA2a(exposure);
                  setA2aFormOpen(true);
                }}
                onCloseA2a={() => {
                  setEditingA2a(null);
                  setA2aFormOpen(false);
                }}
                onDeleteA2a={(exposure) =>
                  requestDelete(
                    "Delete A2A exposure",
                    `Delete the external exposure “${exposure.slug}”? Existing A2A task records for it will also be removed.`,
                    () => deleteById("a2a/exposures", exposure.id),
                  )
                }
                onSubmitA2a={(event) => run(() => saveA2a(event))}
              />
            )}
          </>
        )}
      </main>
      {loginOpen && !isAuthenticated && (
        <LoginDialog
          onClose={() => setLoginOpen(false)}
          onLogin={login}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void run(async () => {
              await confirm.action();
              setConfirm(null);
            })
          }
        />
      )}
      {editingSession && (
        <SessionRenameDialog
          session={editingSession}
          onCancel={() => setEditingSession(null)}
          onSave={(title) => void run(() => renameSession(title))}
        />
      )}
    </div>
  );
}

function ThemeControl({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <IconButton
      className="theme-toggle"
      icon={theme === "dark" ? "sun" : "moon"}
      label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      ariaPressed={theme === "light"}
      onClick={onToggle}
    />
  );
}

function IconButton({
  icon,
  label,
  onClick,
  className = "",
  disabled = false,
  type = "button",
  ariaPressed,
}: {
  icon: NavIconName;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaPressed?: boolean;
}) {
  return (
    <button
      type={type}
      className={`icon-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-pressed={ariaPressed}
      title={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
    >
      <NavIcon name={icon} />
    </button>
  );
}

function ActionButton({
  icon,
  variant = "secondary",
  compact = false,
  className = "",
  disabled = false,
  type = "button",
  onClick,
  name,
  value,
  buttonRef,
  children,
}: {
  icon?: NavIconName;
  variant?: "primary" | "secondary" | "danger" | "quiet";
  compact?: boolean;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  name?: string;
  value?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      ref={buttonRef}
      name={name}
      value={value}
      className={`action-button action-button-${variant}${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <NavIcon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const icons: Record<NavIconName, ReactNode> = {
    add: <><path d="M12 5v14M5 12h14" /></>,
    "arrow-down": <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>,
    "arrow-up": <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    collapse: <><path d="m15 18-6-6 6-6" /><path d="M19 5v14" /></>,
    chat: <><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h1A2.5 2.5 0 0 1 5 11.5v-6Z" /><path d="M8.5 7.8h7M8.5 10.7h4" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    discover: <><circle cx="12" cy="12" r="7" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" /><path d="m13.8 6.7 3.5 3.5" /></>,
    eye: <><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></>,
    "eye-off": <><path d="m3 3 18 18" /><path d="M10.6 7.2A9.6 9.6 0 0 1 12 7c5.8 0 9 5 9 5a16 16 0 0 1-3.1 3.2M6.2 6.3C4.1 7.7 3 9.4 3 9.4s3.2 5 9 5c.9 0 1.7-.1 2.5-.4" /><path d="M10.4 10.4a2.2 2.2 0 0 0 3.2 3.2" /></>,
    inspect: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5M8.5 10.5h4" /></>,
    "log-in": <><path d="M13 5h6v14h-6" /><path d="m3 12 7-7v4h5v6h-5v4l-7-7Z" /></>,
    "log-out": <><path d="M11 5H5v14h6" /><path d="m21 12-7-7v4H9v6h5v4l7-7Z" /></>,
    models: <><path d="M4 6.5 12 3l8 3.5L12 10 4 6.5Z" /><path d="M4 12l8 3.5 8-3.5" /><path d="M4 17.5 12 21l8-3.5" /></>,
    agents: <><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-3.4 3-5 7-5s6.3 1.6 7 5" /><path d="M4 8h1M19 8h1M12 3V2" /></>,
    skills: <><path d="m12 3 2.1 5.1L20 10l-5.9 1.9L12 17l-2.1-5.1L4 10l5.9-1.9L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    tools: <><path d="m14.7 6.3 3-3a4 4 0 0 1-5.3 5.3L6.3 14.7a2.1 2.1 0 1 0 3 3l6.1-6.1a4 4 0 0 1 5.3-5.3l-3 3" /><path d="m5 19-2 2" /></>,
    mcp: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.5-3.6M8.2 13.2l7.5 3.6" /></>,
    memory: <><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    moon: <><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></>,
    open: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" /></>,
    paperclip: <><path d="m9 17 7.5-7.5a3.5 3.5 0 0 0-5-5L4 12a5 5 0 0 0 7 7l7.5-7.5" /><path d="m8 13 5.5-5.5a1.5 1.5 0 0 1 2 2L10 15" /></>,
    play: <><circle cx="12" cy="12" r="8.5" /><path d="m10 8 5 4-5 4V8Z" /></>,
    power: <><path d="M12 3v9" /><path d="M18.4 6.6a8 8 0 1 1-12.8 0" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.2" /><path d="m16 16 4.2 4.2" /></>,
    sessions: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-8Z" /><path d="M8 8h8M8 11.5h5" /></>,
    runs: <><path d="M4 18h16M6 15V9M12 15V5M18 15v-3" /><circle cx="6" cy="7" r="1.5" /><circle cx="12" cy="3" r="1.5" /><circle cx="18" cy="10" r="1.5" /></>,
    save: <><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v5h8V4M8 20v-6h8v6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-2.6v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4.5v-2.6h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4.5h2.6v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v2.6h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    send: <><path d="m4 4 16 8-16 8 3.2-8L4 4Z" /><path d="M7.2 12H20" /></>,
    stop: <><rect x="7" y="7" width="10" height="10" rx="1.5" /></>,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></>,
    trash: <><path d="M5 7h14M10 3h4l1 4H9l1-4Z" /><path d="M7 7.5 8 20h8l1-12.5M10 11v5M14 11v5" /></>,
    upload: <><path d="M12 21V9M7 12l5-5 5 5" /><path d="M5 3h14" /></>,
  };
  return <svg {...common}>{icons[name]}</svg>;
}

function AgentMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
  const avatarSeed = Array.from(name).reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) % 6,
    0,
  );
  return (
    <span
      className={`agent-mark agent-avatar avatar-${avatarSeed + 1}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function AuthLoading({ theme, onThemeToggle }: { theme: Theme; onThemeToggle: () => void }) {
  return (
    <div className="auth-shell">
      <div className="auth-topbar">
        <ThemeControl theme={theme} onToggle={onThemeToggle} />
      </div>
      <div className="auth-card auth-loading" role="status">
        <span className="spinner" />
        Checking access…
      </div>
    </div>
  );
}

function LoginDialog({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    usernameRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password to continue.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onLogin(username.trim(), password);
    } catch (e) {
      setPassword("");
      setError(
        e instanceof ApiError && e.status === 401
          ? "Invalid username or password."
          : e instanceof Error
            ? e.message
            : "Unable to sign in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-layer">
      <button type="button" className="login-scrim" aria-label="Close sign in" onClick={onClose} />
      <section
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        aria-describedby="login-description"
      >
        <div className="login-dialog-head">
          <div className="auth-brand">
            <div className="logo" aria-hidden="true">OA</div>
            <div>
              <strong>Open Agent</strong>
              <span>Console</span>
            </div>
          </div>
          <IconButton icon="close" className="login-close" label="Close sign in" onClick={onClose} />
        </div>
        <div className="login-dialog-body">
          <span className="login-dialog-mark">ACCESS GATE</span>
          <p className="eyebrow">SELF-CONTAINED AGENT RUNTIME</p>
          <h2 id="login-title">Sign in to your runtime.</h2>
          <p id="login-description" className="auth-lede">
            Guest preview is available. Sign in to unlock your workspace and manage runtime configuration.
          </p>
          {error && <div className="banner error" role="alert">{error}</div>}
          <form className="form auth-form" noValidate onSubmit={(event) => void submit(event)}>
            <label className="field" htmlFor="login-username">
              Username
              <input
                ref={usernameRef}
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <span className="password-control">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <IconButton
                  icon={showPassword ? "eye-off" : "eye"}
                  className="password-toggle"
                  label={showPassword ? "Hide password" : "Show password"}
                  ariaPressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                />
              </span>
            </div>
            <ActionButton icon="log-in" variant="primary" className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </ActionButton>
          </form>
          <p className="auth-note">
            Demo credentials come from environment variables. Passwords are never stored in the browser.
          </p>
        </div>
      </section>
    </div>
  );
}

function Dashboard({
  role,
  agents,
  models,
  skills,
  tools,
  connectors,
  sessions,
  latestErrors,
  onPage,
  onSettings,
  onChat,
  onSession,
}: {
  role: AccessRole;
  agents: Agent[];
  models: Model[];
  skills: Skill[];
  tools: Tool[];
  connectors: MemoryConnector[];
  sessions: Session[];
  latestErrors: Run[];
  onPage: (page: Page) => void;
  onSettings: (page: Page) => void;
  onChat: (agent: Agent, initialText?: string) => void;
  onSession: (session: Session) => void;
}) {
  const availableAgents = agents.filter((agent) => agent.enabled);
  const recentSessions = sessions.slice(0, 4);
  const [homeText, setHomeText] = useState("");
  const [homeAgentId, setHomeAgentId] = useState("");
  const primaryAgent = availableAgents.find((agent) => agent.id === homeAgentId) ?? availableAgents[0];
  const emptyComposerLabel = role === "guest"
    ? "Guest access only"
    : role === "admin"
      ? "Enable an agent in Settings"
      : "No agents available";

  useEffect(() => {
    if (!availableAgents.some((agent) => agent.id === homeAgentId)) {
      setHomeAgentId(availableAgents[0]?.id ?? "");
    }
  }, [availableAgents, homeAgentId]);

  function submitHomeMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = homeText.trim();
    if (!primaryAgent || !text) return;
    onChat(primaryAgent, text);
    setHomeText("");
  }

  return (
    <section className="dashboard-screen conversation-home">
      <div className="section-intro dashboard-hero">
        <div>
          <h2>How can I help?</h2>
          <p>
            Choose an agent to start a focused conversation. Your sessions stay in the
            left rail so you can pick up where you left off.
          </p>
        </div>
        <div className="dashboard-hero-actions">
          <span className="workspace-status"><i /> Runtime ready</span>
          {role === "admin" ? (
            <ActionButton
              icon="settings"
              variant="secondary"
              compact
              onClick={() => onSettings("agents")}
            >
              Manage agents
            </ActionButton>
          ) : (
            <ActionButton icon="sessions" variant="secondary" compact onClick={() => onPage("sessions")}>
              View conversations
            </ActionButton>
          )}
        </div>
      </div>
      <form className="home-composer" noValidate onSubmit={submitHomeMessage}>
        <textarea
          className="resize-none"
          aria-label="Message your agent"
          rows={1}
          value={homeText}
          disabled={!primaryAgent}
          onChange={(event) => setHomeText(event.target.value)}
          onKeyDown={submitMessageOnEnter}
          placeholder={primaryAgent ? "Message your agent" : "No enabled agents available"}
        />
        <div className="home-composer-toolbar">
          {primaryAgent ? (
            <div className="home-composer-agent">
              <AgentMark name={primaryAgent.name} />
              <span>
                <small>Agent</small>
                <SearchableSelect
                  id="home-agent"
                  label="agents"
                  value={primaryAgent.id}
                  options={availableAgents.map((agent) => ({
                    value: agent.id,
                    label: agent.name,
                    searchText: agent.description ?? "",
                  }))}
                  onChange={setHomeAgentId}
                />
              </span>
            </div>
          ) : (
            <div className="home-composer-agent">
              <span className="home-composer-agent-dot" />
              <span>
                <small>Workspace</small>
                <strong>{emptyComposerLabel}</strong>
              </span>
            </div>
          )}
          <span className="home-composer-hint">Enter to send · Shift+Enter for a new line</span>
          <ActionButton
            icon="send"
            variant="primary"
            compact
            type="submit"
            disabled={!primaryAgent || !homeText.trim()}
          >
            Start chat
          </ActionButton>
        </div>
      </form>
      <div className="cards">
        <Metric label="Agents" value={agents.length} hint="Runtime instances" />
        <Metric label="Models" value={models.length} hint="Provider adapters" />
        <Metric
          label="Skills"
          value={skills.length}
          hint="Reusable instructions"
        />
        <Metric label="Tools" value={tools.length} hint="Bounded actions" />
      </div>
      <div className="dashboard-inventory-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SYSTEM MAP</p>
              <h2>Runtime inventory</h2>
            </div>
            <span className="tag">
              {sessions.length} conversations
            </span>
          </div>
          <div className="inventory">
            <Inventory
              label="Models"
              value={models.length}
              onClick={role === "admin" ? () => onSettings("models") : undefined}
            />
            <Inventory
              label="Agents"
              value={agents.filter((agent) => agent.enabled).length}
              suffix="enabled"
              onClick={role === "admin" ? () => onSettings("agents") : undefined}
            />
            <Inventory
              label="Memory connectors"
              value={connectors.length}
              onClick={role === "admin" ? () => onSettings("memory") : undefined}
            />
          </div>
        </div>
      </div>
      <div className="panel agent-launchpad">
        <div className="panel-heading">
          <div>
            <h2>Choose an agent</h2>
          </div>
          <span className="tag">{availableAgents.length} available</span>
        </div>
        {availableAgents.length === 0 ? (
          <EmptyState
            title="No agents available"
            body={
              role === "guest"
                ? "Ask an administrator to publish an agent for guest access."
                : "Enable an agent in Settings to start a conversation."
            }
          />
        ) : (
          availableAgents.map((agent) => (
            <div className="row" key={agent.id}>
              <div className="agent-row-copy">
                <AgentMark name={agent.name} />
                <div>
                  <strong>{agent.name}</strong>
                  <span>{agent.description || "Ready for a new session."}</span>
                </div>
              </div>
              <ActionButton icon="chat" variant="secondary" compact onClick={() => onChat(agent)}>
                Chat
              </ActionButton>
            </div>
          ))
        )}
      </div>
      <div className="dashboard-secondary-grid">
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CONTINUE WHERE YOU LEFT OFF</p>
              <h2>Recent conversations</h2>
            </div>
            <ActionButton icon="sessions" variant="quiet" compact onClick={() => onPage("sessions")}>
              View all
            </ActionButton>
          </div>
          {recentSessions.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              body="Your next chat will appear here for quick access."
            />
          ) : (
            recentSessions.map((session) => (
              <div className="row conversation-row" key={session.id}>
                <button type="button" className="conversation-link" onClick={() => onSession(session)}>
                  <span className="conversation-icon" aria-hidden="true"><NavIcon name="sessions" /></span>
                  <span>
                    <strong>{session.title || "Untitled session"}</strong>
                    <small>{agents.find((agent) => agent.id === session.agentId)?.name ?? session.agentId} · {formatDate(session.updatedAt)}</small>
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ATTENTION</p>
              <h2>Needs review</h2>
            </div>
            <ActionButton icon="sessions" variant="quiet" compact onClick={() => onPage("sessions")}>
              View conversations
            </ActionButton>
          </div>
          {latestErrors.length === 0 ? (
            <EmptyState
              title="Nothing needs attention"
              body="Failed executions stay attached to the conversation where they occurred."
            />
          ) : (
            latestErrors.map((run) => (
              <div className="row" key={run.id}>
                <div>
                  <strong>{sessions.find((session) => session.id === run.sessionId)?.title || "Untitled conversation"}</strong>
                  <span>{run.error ?? "Unknown error"}</span>
                </div>
                {sessions.some((session) => session.id === run.sessionId) ? (
                  <ActionButton
                    icon="open"
                    variant="secondary"
                    compact
                    onClick={() => {
                      const session = sessions.find((item) => item.id === run.sessionId);
                      if (session) onSession(session);
                    }}
                  >
                    Open
                  </ActionButton>
                ) : (
                  <span className="pill failed">failed</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ModelsPage({
  models,
  editing,
  onEdit,
  onDelete,
  onTest,
  onSubmit,
}: {
  models: Model[];
  editing: Model | null;
  onEdit: (model: Model | null) => void;
  onDelete: (model: Model) => void;
  onTest: (model: Model) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const openAdd = () => {
    setIsAdding(true);
    onEdit(null);
  };
  const openEdit = (model: Model) => {
    setIsAdding(false);
    onEdit(model);
  };
  const closeForm = () => {
    setIsAdding(false);
    onEdit(null);
  };
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onSubmit(event)) setIsAdding(false);
  };
  const formOpen = isAdding || Boolean(editing);

  return (
    <section className="stack registry-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 01</p>
            <h2>Model registry</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="tag">{models.length} configured</span>
            <AddButton label="model" onClick={openAdd} />
          </div>
        </div>
        {models.length === 0 ? (
          <EmptyState
            title="No models yet"
            body="Add a provider adapter to make an agent runnable."
          />
        ) : (
          models.map((model) => (
            <div className="row registry-row" key={model.id}>
              <div>
                <strong>
                  {model.name}{" "}
                  {!model.enabled && (
                    <span className="muted-inline">disabled</span>
                  )}
                </strong>
                <span>
                  {model.provider} · {model.modelId}
                </span>
                <code>{model.apiKeyEnv || "No credential required"}</code>
              </div>
              <div className="actions">
                <IconButton icon="play" label={`Test ${model.name}`} onClick={() => onTest(model)} />
                <IconButton icon="edit" label={`Edit ${model.name}`} onClick={() => openEdit(model)} />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${model.name}`}
                  onClick={() => onDelete(model)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      {formOpen && (
        <FormDialog
          title={editing ? "Edit model" : "Add model"}
          onClose={closeForm}
        >
          <ModelForm
            editing={editing}
            onCancel={closeForm}
            onSubmit={submitForm}
          />
        </FormDialog>
      )}
    </section>
  );
}
function ModelForm({
  editing,
  onCancel,
  onSubmit,
}: {
  editing: Model | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form
      key={editing?.id ?? "new-model"}
      className="form registry-form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="MODEL CONFIGURATION"
        title={editing ? "Edit model" : "Add model"}
        onCancel={onCancel}
      />
      <Field id="model-name" label="Name">
        <input
          id="model-name"
          name="name"
          required
          defaultValue={editing?.name ?? ""}
        />
      </Field>
      <Field id="model-provider" label="Provider">
        <SearchableSelect
          id="model-provider"
          name="provider"
          label="providers"
          defaultValue={editing?.provider ?? "openai"}
          options={[
            { value: "openai", label: "OpenAI" },
            { value: "openai-compatible", label: "OpenAI compatible" },
            { value: "anthropic", label: "Anthropic" },
            { value: "google", label: "Google Gemini" },
            { value: "ollama", label: "Ollama" },
            { value: "fake", label: "Deterministic fake (CI)" },
          ]}
        />
      </Field>
      <Field id="model-id" label="Model ID">
        <input
          id="model-id"
          name="modelId"
          required
          defaultValue={editing?.modelId ?? ""}
        />
      </Field>
      <Field id="model-base-url" label="Base URL">
        <input
          id="model-base-url"
          name="baseUrl"
          defaultValue={editing?.baseUrl ?? ""}
          placeholder="Required for compatible; optional for Ollama"
        />
      </Field>
      <Field id="model-api-key" label="Credential environment variable">
        <input
          id="model-api-key"
          name="apiKeyEnv"
          defaultValue={editing?.apiKeyEnv ?? "OPENAI_API_KEY"}
          placeholder="Blank for Ollama or fake"
        />
      </Field>
      <div className="form-grid">
        <Field id="model-temperature" label="Temperature">
          <input
            id="model-temperature"
            name="temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            defaultValue={editing?.temperature ?? ""}
          />
        </Field>
        <Field id="model-max-tokens" label="Max tokens">
          <input
            id="model-max-tokens"
            name="maxTokens"
            type="number"
            min="1"
            defaultValue={editing?.maxTokens ?? ""}
          />
        </Field>
        <Field id="model-timeout" label="Timeout (ms)">
          <input
            id="model-timeout"
            name="timeoutMs"
            type="number"
            min="1000"
            max="300000"
            defaultValue={editing?.timeoutMs ?? 60000}
          />
        </Field>
        <Field id="model-retries" label="Retries">
          <input
            id="model-retries"
            name="maxRetries"
            type="number"
            min="0"
            max="10"
            defaultValue={editing?.maxRetries ?? 2}
          />
        </Field>
      </div>
      <fieldset>
        <legend>Capabilities</legend>
        {capabilities.map((capability) => (
          <label className="check" key={capability}>
            <input
              type="checkbox"
              name="capabilities"
              value={capability}
              defaultChecked={
                editing
                  ? editing.capabilities.includes(capability)
                  : capability === "streaming"
              }
            />
            {capability}
          </label>
        ))}
      </fieldset>
      <ActionButton icon="save" variant="primary" type="submit">
        {editing ? "Update model" : "Save model"}
      </ActionButton>
    </form>
  );
}

function AgentsPage({
  agents,
  models,
  skills,
  tools,
  connectors,
  editing,
  draftSkillIds,
  draftToolIds,
  promptPreview,
  onNew,
  onEdit,
  onDraftSkills,
  onDraftTools,
  onPreview,
  onDelete,
  onDuplicate,
  onEnabled,
  onChat,
  onSubmit,
}: {
  agents: Agent[];
  models: Model[];
  skills: Skill[];
  tools: Tool[];
  connectors: MemoryConnector[];
  editing: Agent | null;
  draftSkillIds: string[];
  draftToolIds: string[];
  promptPreview?: string;
  onNew: () => void;
  onEdit: (agent: Agent) => void;
  onDraftSkills: (ids: string[]) => void;
  onDraftTools: (ids: string[]) => void;
  onPreview: () => void;
  onDelete: (agent: Agent) => void;
  onDuplicate: (agent: Agent) => void;
  onEnabled: (agent: Agent) => void;
  onChat: (agent: Agent) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const openAdd = () => {
    setIsAdding(true);
    onNew();
  };
  const openEdit = (agent: Agent) => {
    setIsAdding(false);
    onEdit(agent);
  };
  const closeForm = () => {
    setIsAdding(false);
    onNew();
  };
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onSubmit(event)) setIsAdding(false);
  };
  const formOpen = isAdding || Boolean(editing);

  return (
    <section className="stack registry-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 02</p>
            <h2>Agent registry</h2>
          </div>
          <AddButton label="agent" onClick={openAdd} />
        </div>
        {agents.length === 0 ? (
          <EmptyState
            title="No agents yet"
            body="An agent combines a model with instructions and optional runtime modules."
          />
        ) : (
          agents.map((agent) => (
            <div className="row registry-row" key={agent.id}>
              <div>
                <strong>
                  {agent.name}{" "}
                  {!agent.enabled && (
                    <span className="muted-inline">disabled</span>
                  )}
                </strong>
                <span>
                  {agent.description || "No description"} ·{" "}
                  {models.find((model) => model.id === agent.modelRef)?.name ??
                    "Unknown model"}
                </span>
                <span className={`access-label ${agent.accessLevel ?? "user"}`}>
                  Access: {agentAccessLabel(agent.accessLevel)}
                </span>
                <code>
                  {agent.skillIds.length} skills · {agent.toolIds.length} tools
                </code>
              </div>
              <div className="actions">
                <IconButton
                  icon="chat"
                  label={`Chat with ${agent.name}`}
                  disabled={!agent.enabled}
                  onClick={() => onChat(agent)}
                />
                <IconButton icon="edit" label={`Edit ${agent.name}`} onClick={() => openEdit(agent)} />
                <IconButton icon="copy" label={`Duplicate ${agent.name}`} onClick={() => onDuplicate(agent)} />
                <IconButton
                  icon="power"
                  label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`}
                  onClick={() => onEnabled(agent)}
                />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${agent.name}`}
                  onClick={() => onDelete(agent)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      {formOpen && (
        <FormDialog
          title={editing ? "Edit agent" : "Create agent"}
          onClose={closeForm}
        >
          <AgentForm
            editing={editing}
            models={models}
            skills={skills}
            tools={tools}
            connectors={connectors}
            draftSkillIds={draftSkillIds}
            draftToolIds={draftToolIds}
            promptPreview={promptPreview}
            onCancel={closeForm}
            onDraftSkills={onDraftSkills}
            onDraftTools={onDraftTools}
            onPreview={onPreview}
            onSubmit={submitForm}
          />
        </FormDialog>
      )}
    </section>
  );
}
function AgentForm({
  editing,
  models,
  skills,
  tools,
  connectors,
  draftSkillIds,
  draftToolIds,
  promptPreview,
  onCancel,
  onDraftSkills,
  onDraftTools,
  onPreview,
  onSubmit,
}: {
  editing: Agent | null;
  models: Model[];
  skills: Skill[];
  tools: Tool[];
  connectors: MemoryConnector[];
  draftSkillIds: string[];
  draftToolIds: string[];
  promptPreview?: string;
  onCancel: () => void;
  onDraftSkills: (ids: string[]) => void;
  onDraftTools: (ids: string[]) => void;
  onPreview: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form
      key={editing?.id ?? "new-agent"}
      className="form registry-form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="AGENT CONFIGURATION"
        title={editing ? "Edit agent" : "Create agent"}
        onCancel={onCancel}
      />
      <Field id="agent-name" label="Name">
        <input
          id="agent-name"
          name="name"
          required
          defaultValue={editing?.name ?? ""}
        />
      </Field>
      <Field id="agent-description" label="Description">
        <input
          id="agent-description"
          name="description"
          defaultValue={editing?.description ?? ""}
        />
      </Field>
      <Field id="agent-model" label="Model">
        <SearchableSelect
          id="agent-model"
          name="modelRef"
          label="models"
          required
          defaultValue={editing?.modelRef ?? ""}
          placeholder="Select model"
          options={models.map((model) => ({
            value: model.id,
            label: model.name,
            searchText: `${model.provider} ${model.modelId}`,
          }))}
        />
      </Field>
      <Field id="agent-memory" label="Memory connector">
        <SearchableSelect
          id="agent-memory"
          name="memoryConnectorId"
          label="memory connectors"
          defaultValue={editing?.memoryConnectorId ?? ""}
          placeholder="None"
          options={connectors.map((connector) => ({
            value: connector.id,
            label: `${connector.name} · ${connector.type}`,
          }))}
        />
      </Field>
      <Field id="agent-access" label="Agent access">
        <select
          id="agent-access"
          name="accessLevel"
          defaultValue={editing?.accessLevel ?? "user"}
        >
          <option value="guest">Guest access · guests and users</option>
          <option value="user">User access · users only</option>
          <option value="admin">Admin only</option>
        </select>
      </Field>
      <p className="field-help">
        Guests can only chat with agents explicitly marked for guest access.
      </p>
      <Field id="agent-instructions" label="Instructions">
        <textarea
          className="resize-none"
          id="agent-instructions"
          name="instructions"
          required
          rows={7}
          defaultValue={editing?.instructions ?? ""}
        />
      </Field>
      <div className="form-grid">
        <Field id="agent-temperature" label="Temperature">
          <input
            id="agent-temperature"
            name="temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            defaultValue={editing?.temperature ?? ""}
          />
        </Field>
        <Field id="agent-max-tokens" label="Max tokens">
          <input
            id="agent-max-tokens"
            name="maxTokens"
            type="number"
            min="1"
            defaultValue={editing?.maxTokens ?? ""}
          />
        </Field>
        <Field id="agent-model-calls" label="Max model calls">
          <input
            id="agent-model-calls"
            name="maxModelCalls"
            type="number"
            min="1"
            max="50"
            defaultValue={editing?.maxModelCalls ?? 6}
          />
        </Field>
        <Field id="agent-tool-calls" label="Max tool calls">
          <input
            id="agent-tool-calls"
            name="maxToolCalls"
            type="number"
            min="1"
            max="100"
            defaultValue={editing?.maxToolCalls ?? 10}
          />
        </Field>
      </div>
      <OrderedPicker
        label="Skills"
        items={skills}
        selectedIds={draftSkillIds}
        onChange={onDraftSkills}
      />
      <OrderedPicker
        label="Tools"
        items={tools}
        selectedIds={draftToolIds}
        onChange={onDraftTools}
      />
      <div className="form-actions">
        <ActionButton
          icon="inspect"
          variant="secondary"
          compact
          disabled={!editing}
          onClick={onPreview}
        >
          Preview effective prompt
        </ActionButton>
        <ActionButton icon="save" variant="primary" type="submit" disabled={!models.length}>
          {editing ? "Update agent" : "Create agent"}
        </ActionButton>
      </div>
      {promptPreview && (
        <div className="preview">
          <div className="preview-heading">
            <span>Effective prompt preview</span>
            <span className="tag">Read-only</span>
          </div>
          <pre>{promptPreview}</pre>
        </div>
      )}
    </form>
  );
}

function SkillsPage({
  skills,
  editing,
  onEdit,
  onDelete,
  onSubmit,
}: {
  skills: Skill[];
  editing: Skill | null;
  onEdit: (skill: Skill | null) => void;
  onDelete: (skill: Skill) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const openAdd = () => {
    setIsAdding(true);
    onEdit(null);
  };
  const openEdit = (skill: Skill) => {
    setIsAdding(false);
    onEdit(skill);
  };
  const closeForm = () => {
    setIsAdding(false);
    onEdit(null);
  };
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onSubmit(event)) setIsAdding(false);
  };
  const formOpen = isAdding || Boolean(editing);

  return (
    <section className="stack registry-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 03</p>
            <h2>Skills registry</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="tag">Ordered in agent prompt</span>
            <AddButton label="skill" onClick={openAdd} />
          </div>
        </div>
        {skills.length === 0 ? (
          <EmptyState
            title="No skills yet"
            body="Create reusable instructions, then assign them from the agent editor."
          />
        ) : (
          skills.map((skill) => (
            <div className="row registry-row" key={skill.id}>
              <div>
                <strong>
                  {skill.name}{" "}
                  {!skill.enabled && (
                    <span className="muted-inline">disabled</span>
                  )}
                </strong>
                <span>{skill.description || "No description"}</span>
              </div>
              <div className="actions">
                <IconButton icon="edit" label={`Edit ${skill.name}`} onClick={() => openEdit(skill)} />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${skill.name}`}
                  onClick={() => onDelete(skill)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      {formOpen && (
        <FormDialog
          title={editing ? "Edit skill" : "Add skill"}
          onClose={closeForm}
        >
          <form
            key={editing?.id ?? "new-skill"}
            className="form registry-form"
            noValidate
            onSubmit={(event) => void submitForm(event)}
          >
            <FormHeading
              eyebrow="PROMPT MODULE"
              title={editing ? "Edit skill" : "Add skill"}
              onCancel={closeForm}
            />
            <Field id="skill-name" label="Name">
              <input
                id="skill-name"
                name="name"
                required
                defaultValue={editing?.name ?? ""}
              />
            </Field>
            <Field id="skill-description" label="Description">
              <input
                id="skill-description"
                name="description"
                defaultValue={editing?.description ?? ""}
              />
            </Field>
            <Field id="skill-instructions" label="Instructions">
              <textarea
                className="resize-none"
                id="skill-instructions"
                name="instructions"
                required
                rows={10}
                defaultValue={editing?.instructions ?? ""}
              />
            </Field>
            <label className="switch">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing?.enabled ?? true}
              />
              <span>Available to agents</span>
            </label>
            <ActionButton icon="save" variant="primary" type="submit">
              {editing ? "Update skill" : "Save skill"}
            </ActionButton>
          </form>
        </FormDialog>
      )}
    </section>
  );
}

function ToolsPage({
  tools,
  mcpServers,
  editing,
  onEdit,
  onDelete,
  onSubmit,
}: {
  tools: Tool[];
  mcpServers: McpServer[];
  editing: Tool | null;
  onEdit: (tool: Tool | null) => void;
  onDelete: (tool: Tool) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const openAdd = () => {
    setIsAdding(true);
    onEdit(null);
  };
  const openEdit = (tool: Tool) => {
    setIsAdding(false);
    onEdit(tool);
  };
  const closeForm = () => {
    setIsAdding(false);
    onEdit(null);
  };
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    const intent = new FormData(event.currentTarget).get("intent");
    if (await onSubmit(event) && intent !== "validate") setIsAdding(false);
  };
  const formOpen = isAdding || Boolean(editing);

  return (
    <section className="stack registry-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 04</p>
            <h2>Tools registry</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="tag">Resolver safeguards active</span>
            <AddButton label="tool" onClick={openAdd} />
          </div>
        </div>
        {tools.length === 0 ? (
          <EmptyState
            title="No tools yet"
            body="The seeded calculator and date tools can be mapped immediately."
          />
        ) : (
          tools.map((tool) => (
            <div className="row registry-row" key={tool.id}>
              <div>
                <strong>
                  {tool.name}{" "}
                  {!tool.enabled && (
                    <span className="muted-inline">disabled</span>
                  )}
                </strong>
                <span>
                  {tool.kind}
                  {tool.externalName ? ` · ${tool.externalName}` : ""}
                </span>
              </div>
              <div className="actions">
                <IconButton icon="edit" label={`Edit ${tool.name}`} onClick={() => openEdit(tool)} />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${tool.name}`}
                  onClick={() => onDelete(tool)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      {formOpen && (
        <FormDialog
          title={editing ? "Edit tool" : "Add tool"}
          onClose={closeForm}
        >
          <ToolForm
            editing={editing}
            mcpServers={mcpServers}
            onCancel={closeForm}
            onSubmit={submitForm}
          />
        </FormDialog>
      )}
    </section>
  );
}
function ToolForm({
  editing,
  mcpServers,
  onCancel,
  onSubmit,
}: {
  editing: Tool | null;
  mcpServers: McpServer[];
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form
      key={editing?.id ?? "new-tool"}
      className="form registry-form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="ACTION DEFINITION"
        title={editing ? "Edit tool" : "Add tool"}
        onCancel={onCancel}
      />
      <Field id="tool-name" label="Name">
        <input
          id="tool-name"
          name="name"
          required
          defaultValue={editing?.name ?? ""}
        />
      </Field>
      <Field id="tool-description" label="Description">
        <input
          id="tool-description"
          name="description"
          required
          defaultValue={editing?.description ?? ""}
        />
      </Field>
      <Field id="tool-kind" label="Kind">
        <select
          id="tool-kind"
          name="kind"
          defaultValue={editing?.kind ?? "builtin-calculator"}
        >
          <option value="builtin-calculator">Built-in calculator</option>
          <option value="builtin-datetime">Built-in date/time</option>
          <option value="http">HTTP endpoint</option>
          <option value="mcp">MCP discovered tool</option>
        </select>
      </Field>
      <Field id="tool-config" label="Configuration JSON">
        <textarea
          className="resize-none"
          id="tool-config"
          name="config"
          rows={5}
          defaultValue={jsonText(editing?.config ?? {})}
        />
        <small>
          HTTP example:{" "}
          {`{"url":"https://api.example.com","method":"POST","headers":{"Authorization":{"env":"API_TOKEN"}}}`}
        </small>
      </Field>
      <Field id="tool-schema" label="Input JSON Schema">
        <textarea
          className="resize-none"
          id="tool-schema"
          name="inputSchema"
          rows={6}
          defaultValue={jsonText(
            editing?.inputSchema ?? {
              type: "object",
              additionalProperties: false,
            },
          )}
        />
      </Field>
      <Field id="tool-mcp" label="MCP server">
        <SearchableSelect
          id="tool-mcp"
          name="mcpServerId"
          label="MCP servers"
          defaultValue={editing?.mcpServerId ?? ""}
          placeholder="Select only for MCP tools"
          options={mcpServers.map((server) => ({
            value: server.id,
            label: server.name,
            searchText: server.url,
          }))}
        />
      </Field>
      <Field id="tool-external" label="External MCP name">
        <input
          id="tool-external"
          name="externalName"
          defaultValue={editing?.externalName ?? ""}
          placeholder="Exact discovered tool name"
        />
      </Field>
      <label className="switch">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={editing?.enabled ?? true}
        />
        <span>Available to agents</span>
      </label>
      <div className="form-actions">
        <ActionButton icon="check" variant="secondary" compact type="submit" name="intent" value="validate">
          Validate configuration
        </ActionButton>
        <ActionButton icon="save" variant="primary" type="submit">
          {editing ? "Update tool" : "Save tool"}
        </ActionButton>
      </div>
    </form>
  );
}

function McpPage({
  servers,
  editing,
  onEdit,
  onDelete,
  onDiscover,
  onSubmit,
}: {
  servers: McpServer[];
  editing: McpServer | null;
  onEdit: (server: McpServer | null) => void;
  onDelete: (server: McpServer) => void;
  onDiscover: (server: McpServer) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const openAdd = () => {
    setIsAdding(true);
    onEdit(null);
  };
  const openEdit = (server: McpServer) => {
    setIsAdding(false);
    onEdit(server);
  };
  const closeForm = () => {
    setIsAdding(false);
    onEdit(null);
  };
  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onSubmit(event)) setIsAdding(false);
  };
  const formOpen = isAdding || Boolean(editing);

  return (
    <section className="stack registry-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 05</p>
            <h2>MCP servers</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="tag">HTTP discovery</span>
            <AddButton label="MCP server" onClick={openAdd} />
          </div>
        </div>
        {servers.length === 0 ? (
          <EmptyState
            title="No MCP servers yet"
            body="Register a public HTTP(S) MCP endpoint, then discover its tools."
          />
        ) : (
          servers.map((server) => (
            <div className="row registry-row" key={server.id}>
              <div>
                <strong>
                  {server.name}{" "}
                  {!server.enabled && (
                    <span className="muted-inline">disabled</span>
                  )}
                </strong>
                <span>{server.url}</span>
                <code>
                  {Object.keys(server.headers).length} environment-backed
                  headers
                </code>
              </div>
              <div className="actions">
                <IconButton icon="discover" label={`Discover tools from ${server.name}`} onClick={() => onDiscover(server)} />
                <IconButton icon="edit" label={`Edit ${server.name}`} onClick={() => openEdit(server)} />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${server.name}`}
                  onClick={() => onDelete(server)}
                />
              </div>
            </div>
          ))
        )}
      </div>
      {formOpen && (
        <FormDialog
          title={editing ? "Edit MCP server" : "Add MCP server"}
          onClose={closeForm}
        >
          <form
            key={editing?.id ?? "new-mcp"}
            className="form registry-form"
            noValidate
            onSubmit={(event) => void submitForm(event)}
          >
            <FormHeading
              eyebrow="REMOTE TOOL SOURCE"
              title={editing ? "Edit MCP server" : "Add MCP server"}
              onCancel={closeForm}
            />
            <Field id="mcp-name" label="Name">
              <input
                id="mcp-name"
                name="name"
                required
                defaultValue={editing?.name ?? ""}
              />
            </Field>
            <Field id="mcp-url" label="URL">
              <input
                id="mcp-url"
                name="url"
                type="url"
                required
                defaultValue={editing?.url ?? ""}
                placeholder="https://mcp.example.com"
              />
            </Field>
            <Field id="mcp-headers" label="Headers JSON">
              <textarea
                className="resize-none"
                id="mcp-headers"
                name="headers"
                rows={6}
                defaultValue={jsonText(editing?.headers ?? {})}
              />
              <small>
                Use environment references, for example{" "}
                {`{"Authorization":{"env":"MCP_TOKEN"}}`}.
              </small>
            </Field>
            <label className="switch">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing?.enabled ?? true}
              />
              <span>Available for discovery</span>
            </label>
            <ActionButton icon="save" variant="primary" type="submit">
              {editing ? "Update server" : "Save server"}
            </ActionButton>
          </form>
        </FormDialog>
      )}
    </section>
  );
}

function MemoryPage({
  agents,
  connectors,
  selectedAgent,
  connector,
  memories,
  editingConnector,
  editingMemory,
  onAgent,
  onEditConnector,
  onDeleteConnector,
  onEditMemory,
  onDeleteMemory,
  onConnectorSubmit,
  onMemorySubmit,
}: {
  agents: Agent[];
  connectors: MemoryConnector[];
  selectedAgent: string;
  connector: MemoryConnector | null;
  memories: Memory[];
  editingConnector: MemoryConnector | null;
  editingMemory: Memory | null;
  onAgent: (id: string) => void;
  onEditConnector: (connector: MemoryConnector | null) => void;
  onDeleteConnector: (connector: MemoryConnector) => void;
  onEditMemory: (memory: Memory | null) => void;
  onDeleteMemory: (memory: Memory) => void;
  onConnectorSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onMemorySubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isAddingConnector, setIsAddingConnector] = useState(false);
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const openAddConnector = () => {
    setIsAddingConnector(true);
    onEditConnector(null);
  };
  const openEditConnector = (item: MemoryConnector) => {
    setIsAddingConnector(false);
    onEditConnector(item);
  };
  const closeConnectorForm = () => {
    setIsAddingConnector(false);
    onEditConnector(null);
  };
  const submitConnectorForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onConnectorSubmit(event)) setIsAddingConnector(false);
  };
  const openAddMemory = () => {
    setIsAddingMemory(true);
    onEditMemory(null);
  };
  const openEditMemory = (memory: Memory) => {
    setIsAddingMemory(false);
    onEditMemory(memory);
  };
  const closeMemoryForm = () => {
    setIsAddingMemory(false);
    onEditMemory(null);
  };
  const submitMemoryForm = async (event: FormEvent<HTMLFormElement>) => {
    if (await onMemorySubmit(event)) setIsAddingMemory(false);
  };
  const connectorFormOpen = isAddingConnector || Boolean(editingConnector);
  const memoryFormOpen = isAddingMemory || Boolean(editingMemory);
  const canAddMemory = Boolean(selectedAgent && connector?.type === "sqlite");

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RUNTIME CONTEXT</p>
            <h2>Memory connectors</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="tag">No secrets in exports</span>
            <AddButton label="connector" onClick={openAddConnector} />
          </div>
        </div>
        <div className="connector-grid">
          {connectors.map((item) => (
            <div
              className={`connector-card ${item.enabled ? "" : "disabled"}`}
              key={item.id}
            >
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.type} · {item.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="actions">
                <IconButton icon="edit" label={`Edit ${item.name}`} onClick={() => openEditConnector(item)} />
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Delete ${item.name}`}
                  onClick={() => onDeleteConnector(item)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LONG-TERM MEMORY</p>
              <h2>Saved facts</h2>
            </div>
            <div className="panel-heading-actions">
              <label className="inline-field">
                Agent
                <SearchableSelect
                  id="memory-agent"
                  label="agents"
                  value={selectedAgent}
                  placeholder="Select agent"
                  options={agents.map((agent) => ({
                    value: agent.id,
                    label: agent.name,
                    searchText: agent.description ?? "",
                  }))}
                  onChange={onAgent}
                />
              </label>
              <AddButton
                label="memory"
                onClick={openAddMemory}
                disabled={!canAddMemory}
              />
            </div>
          </div>
          {!selectedAgent ? (
            <EmptyState
              title="Select an agent"
              body="Choose an agent to inspect its connector and saved memories."
            />
          ) : !connector || connector.type !== "sqlite" ? (
            <EmptyState
              title="Memory is not writable"
              body="Assign an enabled SQLite connector in the agent editor to manage long-term memory."
            />
          ) : memories.length === 0 ? (
            <EmptyState
              title="No saved memories"
              body="Add durable context only when it should survive session history."
            />
          ) : (
            memories.map((memory) => (
              <div className="row registry-row" key={memory.id}>
                <div>
                  <strong>{memory.key || "Unkeyed memory"}</strong>
                  <span>{memory.content}</span>
                </div>
                <div className="actions">
                  <IconButton icon="edit" label={`Edit ${memory.key || "memory"}`} onClick={() => openEditMemory(memory)} />
                  <IconButton
                    icon="trash"
                    className="danger"
                    label={`Delete ${memory.key || "memory"}`}
                    onClick={() => onDeleteMemory(memory)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        {memoryFormOpen && (
          <FormDialog
            title={editingMemory ? "Edit memory" : "Add memory"}
            onClose={closeMemoryForm}
          >
            <MemoryForm
              key={editingMemory?.id ?? `${selectedAgent}-new-memory`}
              editing={editingMemory}
              enabled={canAddMemory}
              onCancel={closeMemoryForm}
              onSubmit={submitMemoryForm}
            />
          </FormDialog>
        )}
      </div>
      {connectorFormOpen && (
        <FormDialog
          title={editingConnector ? "Edit connector" : "Add connector"}
          onClose={closeConnectorForm}
        >
          <form
            key={editingConnector?.id ?? "new-connector"}
            className="form registry-form compact-form"
            noValidate
            onSubmit={(event) => void submitConnectorForm(event)}
          >
            <FormHeading
              eyebrow="CONNECTOR CONFIGURATION"
              title={editingConnector ? "Edit connector" : "Add connector"}
              onCancel={closeConnectorForm}
            />
            <Field id="connector-name" label="Name">
              <input
                id="connector-name"
                name="name"
                required
                defaultValue={editingConnector?.name ?? ""}
              />
            </Field>
            <Field id="connector-type" label="Type">
              <select
                id="connector-type"
                name="type"
                defaultValue={editingConnector?.type ?? "sqlite"}
              >
                <option value="none">None</option>
                <option value="sqlite">SQLite</option>
              </select>
            </Field>
            <label className="switch">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editingConnector?.enabled ?? true}
              />
              <span>Enabled</span>
            </label>
            <ActionButton icon="save" variant="primary" type="submit">
              {editingConnector ? "Update connector" : "Save connector"}
            </ActionButton>
          </form>
        </FormDialog>
      )}
    </section>
  );
}
function MemoryForm({
  editing,
  enabled,
  onCancel,
  onSubmit,
}: {
  editing: Memory | null;
  enabled: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form
      key={editing?.id ?? "new-memory"}
      className="form registry-form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="PERSISTED FACT"
        title={editing ? "Edit memory" : "Add memory"}
        onCancel={onCancel}
      />
      <Field id="memory-key" label="Key">
        <input
          id="memory-key"
          name="key"
          defaultValue={editing?.key ?? ""}
          disabled={!enabled}
          placeholder="e.g. preferred_language"
        />
      </Field>
      <Field id="memory-content" label="Content">
        <textarea
          className="resize-none"
          id="memory-content"
          name="content"
          required
          rows={7}
          defaultValue={editing?.content ?? ""}
          disabled={!enabled}
        />
      </Field>
      <Field id="memory-metadata" label="Metadata JSON">
        <textarea
          className="resize-none"
          id="memory-metadata"
          name="metadata"
          rows={4}
          defaultValue={jsonText(editing?.metadata ?? {})}
          disabled={!enabled}
        />
      </Field>
      <ActionButton icon="save" variant="primary" type="submit" disabled={!enabled}>
        {editing ? "Update memory" : "Save memory"}
      </ActionButton>
    </form>
  );
}

function SessionsPage({
  sessions,
  agents,
  onOpen,
  onRename,
  onDelete,
}: {
  sessions: Session[];
  agents: Map<string, string>;
  onOpen: (session: Session) => void;
  onRename: (session: Session) => void;
  onDelete: (session: Session) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CONVERSATION HISTORY</p>
          <h2>All conversations</h2>
        </div>
        <span className="tag">Last 100</span>
      </div>
      {sessions.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          body="Start a new chat from the left rail to create your first conversation."
        />
      ) : (
        sessions.map((session) => (
          <div className="row conversation-manager-row" key={session.id}>
            <div className="conversation-manager-copy">
              <span className="conversation-icon" aria-hidden="true"><NavIcon name="sessions" /></span>
              <div>
              <strong>{session.title || "Untitled session"}</strong>
              <span>{agents.get(session.agentId) ?? session.agentId}</span>
              </div>
            </div>
            <div className="actions">
              <small>{formatDate(session.updatedAt)}</small>
              <IconButton icon="open" label={`Open ${session.title || "conversation"}`} onClick={() => onOpen(session)} />
              <IconButton icon="edit" label={`Rename ${session.title || "conversation"}`} onClick={() => onRename(session)} />
              <IconButton
                icon="trash"
                className="danger"
                label={`Delete ${session.title || "conversation"}`}
                onClick={() => onDelete(session)}
              />
            </div>
          </div>
        ))
      )}
    </section>
  );
}
function RunsPage({
  runs,
  agents,
  selectedRun,
  onOpen,
}: {
  runs: Run[];
  agents: Map<string, string>;
  selectedRun: RunDetail | null;
  onOpen: (run: Run) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">OBSERVABILITY / 02</p>
          <h2>Runs</h2>
        </div>
        <span className="tag">Correlation IDs retained</span>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          body="Agent executions will appear here with status and token usage."
        />
      ) : (
        runs.map((run) => (
          <div className="row" key={run.id}>
            <div>
              <strong>{agents.get(run.agentId) ?? run.agentId}</strong>
              <span>
                {run.error ||
                  `${formatDate(run.startedAt)}${run.totalTokens != null ? ` · ${run.totalTokens} tokens` : ""}`}
              </span>
              {run.correlationId && <code>{run.correlationId}</code>}
            </div>
            <div className="actions">
              <span className={`pill ${run.status}`}>{run.status}</span>
              <IconButton icon="inspect" label="Inspect execution" onClick={() => onOpen(run)} />
            </div>
          </div>
        ))
      )}
      {selectedRun && (
        <div className="run-detail" aria-live="polite">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">RUN DETAIL</p>
              <h2>{agents.get(selectedRun.agentId) ?? selectedRun.agentId}</h2>
            </div>
            <span className={`pill ${selectedRun.status}`}>{selectedRun.status}</span>
          </div>
          <div className="run-facts">
            <span>Started {formatDate(selectedRun.startedAt)}</span>
            <span>{selectedRun.durationMs == null ? "Still running" : `${selectedRun.durationMs} ms`}</span>
            {selectedRun.totalTokens != null && <span>{selectedRun.totalTokens} tokens</span>}
            {selectedRun.contextTruncated && <span className="warning-text">Context bounded</span>}
          </div>
          {selectedRun.correlationId && <code>{selectedRun.correlationId}</code>}
          {selectedRun.error && <p className="error-text">{selectedRun.error}</p>}
          <div className="tool-call-list">
            <strong>Tool calls</strong>
            {selectedRun.toolCalls.length === 0 ? (
              <span className="muted-inline">No tool calls recorded.</span>
            ) : selectedRun.toolCalls.map((call) => (
              <div className="tool-call" key={call.id}>
                <span><strong>{call.toolName}</strong> · {call.status}</span>
                <code>{call.inputJson}</code>
                {call.output && <pre>{call.output}</pre>}
                {call.error && <p className="error-text">{call.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
void RunsPage;

function SettingsPage({
  role,
  agents,
  a2aExposures,
  editingA2a,
  a2aFormOpen,
  onExport,
  onImport,
  onNewA2a,
  onEditA2a,
  onCloseA2a,
  onDeleteA2a,
  onSubmitA2a,
}: {
  role: AccessRole;
  agents: Agent[];
  a2aExposures: A2aExposure[];
  editingA2a: A2aExposure | null;
  a2aFormOpen: boolean;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onNewA2a: () => void;
  onEditA2a: (exposure: A2aExposure) => void;
  onCloseA2a: () => void;
  onDeleteA2a: (exposure: A2aExposure) => void;
  onSubmitA2a: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  if (role === "user") {
    return (
      <section className="settings-grid">
        <div className="panel">
          <p className="eyebrow">WORKSPACE</p>
          <h2>User access</h2>
          <p>
            You can operate enabled agents and review conversations with their activity.
            Runtime configuration is restricted to administrators.
          </p>
          <div className="access-summary">
            <span className="role-badge user"><i /> User</span>
            <span>Operational access only</span>
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">APPEARANCE</p>
          <h2>Theme preference</h2>
          <p>
            Use the theme control in the header to switch between light and dark
            mode. Your preference is saved locally on this device.
          </p>
        </div>
      </section>
    );
  }
  return (
    <>
      <section className="settings-grid">
        <div className="panel">
          <p className="eyebrow">OPERATIONS</p>
          <h2>Registry transfer</h2>
          <p>
            Move model, agent, skill, tool, MCP and connector configuration
            between environments. Export files never include API keys, raw header
            values, other secret values or long-term memories.
          </p>
          <div className="form-actions">
            <ActionButton icon="download" variant="primary" compact onClick={onExport}>
              Export registry
            </ActionButton>
            <label className="file-button">
              <NavIcon name="upload" />
              <span>Import registry</span>
              <input type="file" accept="application/json" onChange={onImport} />
            </label>
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">RUNTIME</p>
          <h2>Deployment posture</h2>
          <div className="settings-list">
            <div>
              <span>Application</span>
              <strong>Open Agent Console v{appVersion}</strong>
            </div>
            <div>
              <span>Persistence</span>
              <strong>SQLite with versioned migrations</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong>Node.js + LangChain</strong>
            </div>
            <div>
              <span>Security</span>
              <strong>Admin-only configuration and environment-backed credentials</strong>
            </div>
          </div>
        </div>
      </section>
      <section className="panel settings-a2a-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AGENT-TO-AGENT</p>
            <h2>External agent exposures</h2>
            <p className="settings-panel-lede">
              Publish selected agents as secure A2A v1.0 endpoints. Each exposure has its own credential reference, rate limit, concurrency budget and lifecycle.
            </p>
          </div>
          <ActionButton icon="add" variant="primary" compact onClick={onNewA2a}>
            New exposure
          </ActionButton>
        </div>
        {a2aExposures.length === 0 ? (
          <div className="empty-state settings-empty">
            <strong>No external exposures yet.</strong>
            <span>Create a draft to define the public contract, then publish it when the agent and credential are ready.</span>
          </div>
        ) : (
          <div className="a2a-exposure-list">
            {a2aExposures.map((exposure) => (
              <div className="a2a-exposure-row" key={exposure.id}>
                <div className="a2a-exposure-main">
                  <div className="a2a-exposure-title">
                    <span className={`a2a-status ${exposure.status}`}>{exposure.status}</span>
                    <strong>{exposure.slug}</strong>
                  </div>
                  <span>{exposure.agent?.name ?? "Unknown agent"} · {exposure.visibility} · {exposure.authMode === "bearer" ? `Bearer · ${exposure.authEnv || "credential missing"}` : "Public, unauthenticated"}</span>
                  <code>/a2a/{exposure.slug}/.well-known/agent-card.json</code>
                </div>
                <div className="a2a-exposure-meta">
                  {!exposure.transportReady && exposure.published && <span className="warning-text">Credential unavailable</span>}
                  <span>{exposure.streaming ? "SSE enabled" : "Polling only"} · {exposure.maxConcurrentTasks} concurrent</span>
                </div>
                <div className="actions">
                  <IconButton icon="edit" label={`Edit ${exposure.slug}`} onClick={() => onEditA2a(exposure)} />
                  <IconButton icon="trash" label={`Delete ${exposure.slug}`} className="danger" onClick={() => onDeleteA2a(exposure)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {a2aFormOpen && (
        <FormDialog title={editingA2a ? "Edit A2A exposure" : "New A2A exposure"} onClose={onCloseA2a}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EXPOSURE CONFIGURATION</p>
              <h2>{editingA2a ? "Edit external endpoint" : "Create external endpoint"}</h2>
            </div>
            <IconButton icon="close" label="Close exposure dialog" onClick={onCloseA2a} />
          </div>
          <form className="form" noValidate onSubmit={(event) => void onSubmitA2a(event).then((saved) => { if (!saved) return; })}>
            <SearchableSelect
              id="a2a-agent"
              name="agentId"
              label="Agent"
              placeholder="Choose an agent"
              options={agents.map((agent) => ({ value: agent.id, label: `${agent.name}${agent.enabled ? "" : " · disabled"}`, searchText: agent.description ?? "" }))}
              defaultValue={editingA2a?.agentId ?? ""}
              disabled={Boolean(editingA2a)}
            />
            <div className="form-grid">
              <Field id="a2a-slug" label="Slug">
                <input id="a2a-slug" name="slug" defaultValue={editingA2a?.slug ?? ""} placeholder="research-assistant" />
              </Field>
              <Field id="a2a-visibility" label="Visibility">
                <select id="a2a-visibility" name="visibility" defaultValue={editingA2a?.visibility ?? "private"}>
                  <option value="private">Private discovery</option>
                  <option value="internal">Internal</option>
                  <option value="public">Public</option>
                </select>
              </Field>
            </div>
            <div className="form-grid">
              <Field id="a2a-auth-mode" label="Transport authentication">
                <select id="a2a-auth-mode" name="authMode" defaultValue={editingA2a?.authMode ?? "bearer"}>
                  <option value="bearer">Bearer token</option>
                  <option value="none">None (public only)</option>
                </select>
              </Field>
              <Field id="a2a-auth-env" label="Credential environment variable">
                <input id="a2a-auth-env" name="authEnv" defaultValue={editingA2a?.authEnv ?? ""} placeholder="OAC_A2A_RESEARCH_TOKEN" />
                <small>Store the secret in the environment; only this variable name is persisted.</small>
              </Field>
            </div>
            <div className="form-grid">
              <Field id="a2a-max-task" label="Max task seconds">
                <input id="a2a-max-task" name="maxTaskSeconds" type="number" min="10" max="3600" defaultValue={editingA2a?.maxTaskSeconds ?? 300} />
              </Field>
              <Field id="a2a-max-requests" label="Requests per minute">
                <input id="a2a-max-requests" name="maxRequestsPerMinute" type="number" min="1" max="10000" defaultValue={editingA2a?.maxRequestsPerMinute ?? 60} />
              </Field>
            </div>
            <Field id="a2a-max-concurrent" label="Concurrent tasks">
              <input id="a2a-max-concurrent" name="maxConcurrentTasks" type="number" min="1" max="32" defaultValue={editingA2a?.maxConcurrentTasks ?? 4} />
            </Field>
            <fieldset>
              <legend>Lifecycle</legend>
              <label className="check"><input type="checkbox" name="enabled" defaultChecked={editingA2a?.enabled ?? false} /> <span>Endpoint enabled</span></label>
              <label className="check"><input type="checkbox" name="published" defaultChecked={editingA2a?.published ?? false} /> <span>Publish exposure</span></label>
              <label className="check"><input type="checkbox" name="streaming" defaultChecked={editingA2a?.streaming ?? true} /> <span>Allow SSE streaming</span></label>
            </fieldset>
            <p className="field-help">Publishing makes the Agent Card and task endpoints available. Private and internal cards still require the same bearer credential as task calls.</p>
            <div className="form-actions">
              <ActionButton icon="close" variant="quiet" compact type="button" onClick={onCloseA2a}>Cancel</ActionButton>
              <ActionButton icon="save" variant="primary" compact type="submit">{editingA2a ? "Save changes" : "Create exposure"}</ActionButton>
            </div>
          </form>
        </FormDialog>
      )}
    </>
  );
}

function ChatWorkspace({
  agent,
  agents,
  messages,
  activity,
  sessionId,
  initialText,
  initialAttachments,
  busy,
  usage,
  onChat,
  onClose,
  onCancel,
  onSend,
}: {
  agent: Agent | null;
  agents: Agent[];
  messages: Message[];
  activity: Run[];
  sessionId?: string;
  initialText: string;
  initialAttachments: ChatAttachment[];
  busy: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  onChat: (agent: Agent, initialText?: string, initialAttachments?: ChatAttachment[]) => void;
  onClose: () => void;
  onCancel: () => void;
  onSend: (value: string, attachments?: ChatAttachment[]) => Promise<void>;
}) {
  if (!agent) return <ChatWelcome agents={agents} onChat={onChat} />;
  return (
    <ChatSurface
      variant="workspace"
      agent={agent}
      messages={messages}
      activity={activity}
      sessionId={sessionId}
      initialText={initialText}
      initialAttachments={initialAttachments}
      busy={busy}
      usage={usage}
      onClose={onClose}
      onCancel={onCancel}
      onSend={onSend}
    />
  );
}

function ChatWelcome({
  agents,
  onChat,
}: {
  agents: Agent[];
  onChat: (agent: Agent, initialText?: string, initialAttachments?: ChatAttachment[]) => void;
}) {
  const [text, setText] = useState("");
  const [agentId, setAgentId] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const agent = agents.find((candidate) => candidate.id === agentId) ?? agents[0];

  useEffect(() => {
    if (!agents.some((candidate) => candidate.id === agentId)) {
      setAgentId(agents[0]?.id ?? "");
    }
  }, [agentId, agents]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!agent || !message) return;
    onChat(agent, message, attachments);
    setText("");
    setAttachments([]);
  }

  return (
    <section className="chat-welcome" aria-label="New conversation">
      <div className="chat-welcome-inner">
        <div className="chat-welcome-brand" aria-hidden="true">
          <span className="chat-welcome-spark">✦</span>
          <span className="chat-welcome-orbit" />
        </div>
        <p className="eyebrow">CONVERSATION WORKSPACE</p>
        <h2>What would you like to work on?</h2>
        <p className="chat-welcome-lede">
          Choose an available agent and start a focused conversation. Your sessions stay in the left rail.
        </p>
        <form className="workspace-composer" noValidate onSubmit={submit}>
          <textarea
            className="resize-none"
            aria-label="Message your agent"
            rows={2}
            value={text}
            disabled={!agent}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={submitMessageOnEnter}
            placeholder={agent ? "Message your agent" : "No agents available"}
          />
          <ChatAttachmentStrip
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          />
          <div className="workspace-composer-toolbar">
            <ChatAttachmentTools
              onAttachmentsChange={setAttachments}
              onVoice={(transcript) => setText((current) => `${current}${current ? " " : ""}${transcript}`)}
            />
            {agent ? (
              <div className="home-composer-agent">
                <AgentMark name={agent.name} />
                <span>
                  <small>Agent</small>
                  <SearchableSelect
                    id="home-agent"
                    label="agents"
                    value={agent.id}
                    options={agents.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.name,
                      searchText: candidate.description ?? "",
                    }))}
                    onChange={setAgentId}
                  />
                </span>
              </div>
            ) : (
              <span className="workspace-empty-label">No agents are available for this account.</span>
            )}
            <span className="home-composer-hint">Enter to send · Shift+Enter for a new line</span>
            <ActionButton
              icon="send"
              variant="primary"
              compact
              type="submit"
              disabled={!agent || !text.trim()}
            >
              Start chat
            </ActionButton>
          </div>
        </form>
        <div className="chat-welcome-agents" aria-label="Available agents">
          <div className="chat-welcome-section-label">Available agents</div>
          {agents.length === 0 ? (
            <EmptyState
              title="No agents available"
              body="Ask an administrator to publish an agent for your role."
            />
          ) : (
            agents.map((candidate) => (
              <div className="chat-agent-option" key={candidate.id}>
                <div className="agent-row-copy">
                  <AgentMark name={candidate.name} />
                  <div>
                    <strong>{candidate.name}</strong>
                    <span>{candidate.description || "Ready for a new conversation."}</span>
                  </div>
                </div>
                <IconButton
                  icon="chat"
                  className="chat-agent-action"
                  label={`Chat with ${candidate.name}`}
                  onClick={() => onChat(candidate)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ChatSurface({
  variant,
  agent,
  messages,
  activity,
  sessionId,
  initialText,
  initialAttachments,
  busy,
  usage,
  onClose,
  onCancel,
  onSend,
}: {
  variant: "drawer" | "workspace";
  agent: Agent;
  messages: Message[];
  activity: Run[];
  sessionId?: string;
  initialText: string;
  initialAttachments: ChatAttachment[];
  busy: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  onClose?: () => void;
  onCancel: () => void;
  onSend: (value: string, attachments?: ChatAttachment[]) => Promise<void>;
}) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>(initialAttachments);
  useEffect(() => {
    setAttachments(initialAttachments);
  }, [initialAttachments]);
  const convertMessage = useCallback(
    (message: Message): ThreadMessageLike => ({
      role: message.role,
      content: message.content,
      id: message.id,
      createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    }),
    [],
  );
  const messagesById = useMemo(
    () => new Map(messages.flatMap((message) => message.id ? [[message.id, message] as const] : [])),
    [messages],
  );
  const handleNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendMessageText(message).trim();
      if (text) {
        await onSend(text, attachments);
        setAttachments([]);
      }
    },
    [attachments, onSend],
  );
  const runtime = useExternalStoreRuntime<Message>({
    messages,
    convertMessage,
    isRunning: busy,
    isSendDisabled: busy,
    onNew: handleNew,
    onCancel: async () => onCancel(),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatDrawerInitialText text={initialText} />
      {variant === "drawer" && onClose && (
        <button type="button" className="chat-scrim" aria-label="Close chat" onClick={onClose} />
      )}
      <section
        className={variant === "workspace" ? "chat-surface chat-surface-workspace" : "chat-drawer"}
        role={variant === "workspace" ? "region" : "complementary"}
        aria-label={`${agent.name} chat`}
      >
        <div className="chat-head">
          <div className="chat-identity">
            <AgentMark name={agent.name} />
            <div>
              <span>{sessionId ? "Saved session" : "New agent chat"}</span>
              <strong>{agent.name}</strong>
              <small>{agent.description || "Ready for a new session."}</small>
            </div>
          </div>
          {onClose && (
            <IconButton
              icon={variant === "workspace" ? "add" : "close"}
              className={variant === "workspace" ? "new-conversation-button" : undefined}
              label={variant === "workspace" ? "Start a new chat" : "Close chat"}
              onClick={onClose}
            />
          )}
        </div>
        <ThreadPrimitive.Root className="chat-thread">
          <ThreadPrimitive.Viewport
            className="chat-thread-viewport"
            autoScroll
            turnAnchor="bottom"
          >
            <div className="chat-thread-messages">
              <AuiIf condition={(state) => state.thread.isEmpty}>
                <div className="chat-empty-state">
                  <AgentMark name={agent.name} />
                  <strong>Start a conversation</strong>
                  <span>Ask {agent.name} to help with a bounded task.</span>
                </div>
              </AuiIf>
              <ThreadPrimitive.Messages>
                {({ message }) => (
                  <ChatUiMessage
                    key={message.id}
                    agentName={agent.name}
                    role={message.role === "system" ? "assistant" : message.role}
                    attachments={message.id ? messagesById.get(message.id)?.attachments : undefined}
                  />
                )}
              </ThreadPrimitive.Messages>
            </div>
            <ThreadPrimitive.ViewportFooter className="chat-thread-footer">
              <ChatActivity runs={activity} />
      {usage && (
        <div className="usage">
          Tokens: {usage.inputTokens ?? "?"} in · {usage.outputTokens ?? "?"}{" "}
          out · {usage.totalTokens ?? "?"} total
        </div>
      )}
      <ComposerPrimitive.Root className="composer" noValidate>
        <div className="composer-input">
          <ChatAttachmentStrip
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          />
          <ComposerPrimitive.Input
            className="resize-none"
            aria-label="Message the agent"
            aria-describedby="chat-composer-hint"
            rows={2}
            maxRows={7}
            submitMode="enter"
            placeholder="Message the agent…"
          />
          <span id="chat-composer-hint" className="composer-hint">
            Enter to send · Shift+Enter for a new line
          </span>
          <AssistantChatComposerTools
            onAttachmentsChange={setAttachments}
          />
        </div>
        <div className="composer-actions">
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel
              type="button"
              className="composer-stop icon-button"
              aria-label="Stop generating"
              title="Stop generating"
              data-tooltip="Stop generating"
            >
              <NavIcon name="stop" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <ComposerPrimitive.Send
            className="composer-send icon-button"
            aria-label={busy ? "Generating response" : "Send message"}
            title={busy ? "Generating response" : "Send message"}
            data-tooltip={busy ? "Generating response" : "Send message"}
          >
            <NavIcon name="send" />
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </section>
    </AssistantRuntimeProvider>
  );
}

function ChatAttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="chat-attachment-strip" aria-label="Attached files">
      {attachments.map((attachment) => (
        <div className="chat-attachment-chip" key={attachment.id}>
          <NavIcon name="paperclip" />
          <span title={attachment.name}>{attachment.name}</span>
          <small>{formatFileSize(attachment.size)}</small>
          <IconButton
            icon="close"
            className="chat-attachment-remove"
            label={`Remove ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
          />
        </div>
      ))}
    </div>
  );
}

type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
};
type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | undefined {
  if (typeof window === "undefined") return undefined;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

function VoiceInputButton({ onTranscript }: { onTranscript: (transcript: string) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = Boolean(getSpeechRecognitionConstructor());

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    },
    [],
  );

  if (!supported) return null;

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) =>
        event.results[index]?.[0]?.transcript ?? "",
      ).join(" ").trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = () => {
      setError(true);
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setError(false);
    setListening(true);
    try {
      recognition.start();
    } catch {
      setError(true);
      setListening(false);
      recognitionRef.current = null;
    }
  }

  return (
    <IconButton
      icon={listening ? "stop" : "mic"}
      className={`composer-tool-button${listening ? " is-listening" : ""}`}
      label={error ? "Voice input unavailable" : listening ? "Stop voice input" : "Start voice input"}
      onClick={toggleListening}
      ariaPressed={listening}
    />
  );
}

function ChatAttachmentTools({
  onAttachmentsChange,
  onVoice,
}: {
  onAttachmentsChange: (update: (current: ChatAttachment[]) => ChatAttachment[]) => void;
  onVoice: (transcript: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    try {
      const next = await Promise.all(files.slice(0, 5).map(readChatAttachment));
      onAttachmentsChange((current) => [...current, ...next].slice(0, 5));
      setError(files.length > 5 ? "Only the first five files were added." : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to attach that file.");
    }
  }

  return (
    <div className="composer-tools" aria-label="Message tools">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept="text/*,.csv,.css,.html,.js,.json,.md,.pdf,.png,.jpg,.jpeg,.webp,.py,.tsx,.ts,.txt,.xml,.yaml,.yml"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => void handleFiles(event)}
      />
      <IconButton
        icon="paperclip"
        className="composer-tool-button"
        label="Attach files"
        onClick={() => fileInputRef.current?.click()}
      />
      <VoiceInputButton onTranscript={onVoice} />
      {error && <span className="composer-tool-error" role="alert">{error}</span>}
    </div>
  );
}

function AssistantChatComposerTools({
  onAttachmentsChange,
}: {
  onAttachmentsChange: (update: (current: ChatAttachment[]) => ChatAttachment[]) => void;
}) {
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);
  return (
    <ChatAttachmentTools
      onAttachmentsChange={onAttachmentsChange}
      onVoice={(transcript) => {
        aui.composer.setText(`${composerText}${composerText ? " " : ""}${transcript}`);
      }}
    />
  );
}

function ChatDrawerInitialText({ text }: { text: string }) {
  const aui = useAui();
  const appliedText = useRef<string | null>(null);

  useEffect(() => {
    if (!text) {
      appliedText.current = null;
      return;
    }
    if (appliedText.current === text) return;
    aui.composer.setText(text);
    appliedText.current = text;
  }, [aui, text]);

  return null;
}

function ChatUiMessage({
  agentName,
  role,
  attachments,
}: {
  agentName: string;
  role: Message["role"];
  attachments?: ChatAttachment[];
}) {
  const isLast = useAuiState((state) => state.message.isLast);
  return (
    <MessagePrimitive.Root
      className={`message ${role}`}
      aria-live={role === "assistant" && isLast ? "polite" : undefined}
    >
      <span>{role === "assistant" ? agentName : "You"}</span>
      {role === "user" && <ChatMessageAttachments attachments={attachments} />}
      <MessagePrimitive.Parts components={{ Text: ChatTextPart }} />
    </MessagePrimitive.Root>
  );
}

function ChatMessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div
      className="message-attachments"
      aria-label={`${attachments.length} attached file${attachments.length === 1 ? "" : "s"}`}
    >
      {attachments.map((attachment) => (
        <div className="message-attachment" key={attachment.id}>
          <NavIcon name="paperclip" />
          <span>
            <strong title={attachment.name}>{attachment.name}</strong>
            <small>{formatFileSize(attachment.size)} · {attachment.mimeType}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ChatTextPart({ text }: TextMessagePartProps) {
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  if (!text) return role === "assistant" && isLast && isRunning ? <TypingIndicator /> : null;
  if (role === "user") return <p>{text}</p>;
  return (
    <div className="markdown">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="typing-indicator" role="status" aria-label="Generating response">
      <i />
      <i />
      <i />
    </div>
  );
}

function ChatActivity({ runs }: { runs: Run[] }) {
  return (
    <details className="chat-activity" open={runs.some((run) => run.status === "failed")}>
      <summary>
        <span className="chat-activity-title">
          <NavIcon name="runs" />
          Activity
        </span>
        <span className="chat-activity-count">
          {runs.length} {runs.length === 1 ? "execution" : "executions"}
        </span>
      </summary>
      <div className="chat-activity-list" aria-live="polite">
        {runs.length === 0 ? (
          <p className="chat-activity-empty">Activity from this conversation will appear here.</p>
        ) : (
          runs.slice(0, 8).map((run) => (
            <div className="chat-activity-row" key={run.id}>
              <span className={`activity-dot ${run.status}`} aria-hidden="true" />
              <span className="chat-activity-copy">
                <strong>{run.status === "completed" ? "Completed response" : `${run.status[0]?.toUpperCase() ?? ""}${run.status.slice(1)} response`}</strong>
                <small>
                  {formatDate(run.startedAt)}
                  {run.totalTokens != null ? ` · ${run.totalTokens} tokens` : ""}
                  {run.error ? ` · ${run.error}` : ""}
                </small>
              </span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <p className="eyebrow">CONFIRM ACTION</p>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="form-actions">
          <ActionButton
            variant="secondary"
            compact
            buttonRef={cancelRef}
            onClick={onCancel}
          >
            Cancel
          </ActionButton>
          <ActionButton icon="trash" variant="danger" compact onClick={onConfirm}>
            Delete
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function SessionRenameDialog({
  session,
  onCancel,
  onSave,
}: {
  session: Session;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(session.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-session-title"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onSave(title.trim());
        }}
      >
        <p className="eyebrow">SESSION LABEL</p>
        <h2 id="rename-session-title">Rename session</h2>
        <label className="field" htmlFor="session-title">
          <span>Title</span>
          <input
            ref={inputRef}
            id="session-title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="form-actions">
          <ActionButton variant="secondary" compact onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton icon="save" variant="primary" compact type="submit" disabled={!title.trim()}>
            Save title
          </ActionButton>
        </div>
      </form>
    </div>
  );
}

function FormHeading({
  eyebrow,
  title,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  onCancel: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <IconButton
        icon="close"
        className="modal-close-button"
        label={`Close ${title}`}
        onClick={onCancel}
      />
    </div>
  );
}

function AddButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon="add"
      className="add-button"
      label={`Add ${label}`}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function FormDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, select, textarea",
    );
    firstControl?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop registry-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal registry-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </div>
    </div>
  );
}
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      {children}
    </label>
  );
}

function SearchableSelect({
  id,
  name,
  label,
  options,
  value,
  defaultValue = "",
  placeholder = "Select an option",
  onChange,
  required = false,
  disabled = false,
}: {
  id: string;
  name?: string;
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const searchable = options.length > 5;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedValue = controlled ? value : internalValue;
  const selected = options.find((option) => option.value === selectedValue);
  const filtered = options.filter((option) => {
    const haystack = `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase());
  });

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handleDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function choose(nextValue: string) {
    if (!controlled) setInternalValue(nextValue);
    onChange?.(nextValue);
    setQuery("");
    setOpen(false);
  }

  if (!searchable) {
    return (
      <select
        id={id}
        name={name}
        aria-labelledby={`${id}-label`}
        aria-label={label}
        value={controlled ? value : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        required={required}
        onChange={(event) => {
          if (!controlled) setInternalValue(event.target.value);
          onChange?.(event.target.value);
        }}
        disabled={disabled}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="searchable-select" ref={rootRef}>
      {name && <input type="hidden" id={`${id}-value`} name={name} value={selectedValue} readOnly />}
      <button
        type="button"
        id={id}
        className="searchable-select-trigger"
        aria-labelledby={`${id}-label`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-required={required}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if ((event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder}</span>
        <span className="searchable-select-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="searchable-select-menu" id={`${id}-listbox`} role="listbox" aria-label={label}>
          <div className="searchable-select-search">
            <NavIcon name="search" />
            <input
              ref={searchRef}
              value={query}
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              placeholder={`Search ${label.toLocaleLowerCase()}`}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <IconButton
                icon="close"
                className="searchable-select-clear"
                label={`Clear ${label.toLocaleLowerCase()} search`}
                onClick={() => setQuery("")}
              />
            )}
          </div>
          <div className="searchable-select-options">
            {filtered.length === 0 ? (
              <p className="searchable-select-empty">No matches</p>
            ) : (
              filtered.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === selectedValue}
                  className={`searchable-select-option${option.value === selectedValue ? " selected" : ""}`}
                  key={option.value}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label}</span>
                  {option.value === selectedValue && <span aria-hidden="true">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function OrderedPicker({
  label,
  items,
  selectedIds,
  onChange,
}: {
  label: string;
  items: Array<{ id: string; name: string; description?: string | null }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = items.filter((item) => selectedIds.includes(item.id));
  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    );
  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="picker">
      <legend>
        {label} <span>{selected.length} selected</span>
      </legend>
      <div className="picker-options">
        {items.length === 0 ? (
          <small>No {label.toLowerCase()} available yet.</small>
        ) : (
          items.map((item) => (
            <label className="check picker-option" key={item.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => toggle(item.id)}
              />
              <span>
                <strong>{item.name}</strong>
                <small>{item.description || "Available runtime module"}</small>
              </span>
            </label>
          ))
        )}
      </div>
      {selected.length > 0 && (
        <div className="ordered-list">
          <small>Prompt/tool order</small>
          {selected.map((item, index) => (
            <div className="ordered-item" key={item.id}>
              <span>
                {index + 1}. {item.name}
              </span>
              <span>
                <IconButton
                  icon="arrow-up"
                  label={`Move ${item.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <IconButton
                  icon="arrow-down"
                  label={`Move ${item.name} down`}
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function Inventory({
  label,
  value,
  suffix,
  onClick,
}: {
  label: string;
  value: number;
  suffix?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>
        {value} <small>{suffix}</small>
      </strong>
    </>
  );
  return onClick ? (
    <button type="button" className="inventory-item" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="inventory-item static">{content}</div>
  );
}
function agentAccessLabel(value: AgentAccessLevel | undefined): string {
  if (value === "admin") return "Admins only";
  if (value === "guest") return "Guests and users";
  return "Users and guests";
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
