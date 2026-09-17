import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  instructions: string;
  enabled: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  maxModelCalls: number;
  maxToolCalls: number;
  skillIds: string[];
  toolIds: string[];
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
};
type PageResponse<T> = { items: T[]; offset: number; limit: number };
type Page =
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
type ConfirmState = {
  title: string;
  message: string;
  action: () => Promise<void>;
} | null;

const nav: Array<[Page, string, string]> = [
  ["dashboard", "Dashboard", "Overview"],
  ["models", "Models", "Providers"],
  ["agents", "Agents", "Runtime instances"],
  ["skills", "Skills", "Prompt modules"],
  ["tools", "Tools", "Actions"],
  ["mcp", "MCP servers", "Remote tools"],
  ["memory", "Memory", "Long-term context"],
  ["sessions", "Sessions", "Conversation history"],
  ["runs", "Runs", "Execution log"],
  ["settings", "Settings", "Operations"],
];
const capabilities = [
  "streaming",
  "tools",
  "vision",
  "audio",
  "structured-output",
];
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
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
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [connectors, setConnectors] = useState<MemoryConnector[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [editingMcp, setEditingMcp] = useState<McpServer | null>(null);
  const [editingConnector, setEditingConnector] =
    useState<MemoryConnector | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [chatText, setChatText] = useState("");
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
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
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
      setModels(modelRows);
      setAgents(agentRows);
      setSkills(skillRows);
      setTools(toolRows);
      setMcpServers(mcpRows);
      setConnectors(connectorRows);
      setSessions(sessionPage.items);
      setRuns(runPage.items);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    document.title = `${nav.find(([key]) => key === page)?.[1] ?? "Console"} · Open Agent Console`;
  }, [page]);
  useEffect(() => {
    if (!selectedMemoryAgent && agents[0]) setSelectedMemoryAgent(agents[0].id);
  }, [agents, selectedMemoryAgent]);
  useEffect(() => {
    if (!selectedMemoryAgent) return;
    void json<{ connector: MemoryConnector | null; items: Memory[] }>(
      `/api/agents/${selectedMemoryAgent}/memories`,
    )
      .then((result) => {
        setMemoryConnector(result.connector);
        setMemories(result.items);
      })
      .catch((e: Error) => setError(e.message));
  }, [selectedMemoryAgent, agents]);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const latestErrors = useMemo(
    () => runs.filter((run) => run.status === "failed").slice(0, 5),
    [runs],
  );
  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
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
  function startNewChat(agent: Agent) {
    setChatAgent(agent);
    setMessages([]);
    setSessionId(undefined);
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
      const stored = await json<
        Array<{ id: string; role: string; content: string; createdAt: string }>
      >(`/api/sessions/${session.id}/messages`);
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
          })),
      );
      setSessionId(session.id);
      setChatAgent(agent);
      setUsage(undefined);
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
  async function openRun(row: Run) {
    await run(async () => {
      setSelectedRun(await json<RunDetail>(`/api/runs/${row.id}`));
    });
  }
  function closeChat() {
    abortRef.current?.abort();
    setChatAgent(null);
    setMessages([]);
    setSessionId(undefined);
    setUsage(undefined);
    setBusy(false);
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!chatAgent || !chatText.trim() || busy) return;
    const text = chatText.trim();
    const controller = new AbortController();
    abortRef.current = controller;
    setChatText("");
    setBusy(true);
    setError(undefined);
    setUsage(undefined);
    setMessages((current) => [
      ...current,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch(`/api/agents/${chatAgent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ message: text, sessionId }),
      });
      if (!response.ok || !response.body)
        throw new Error(`Chat request failed: ${response.status}`);
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
          if (payload.type === "session") setSessionId(payload.sessionId);
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
    } catch (e) {
      if (controller.signal.aborted)
        setMessages((current) =>
          current.map((message, index) =>
            index === current.length - 1 && !message.content
              ? { ...message, content: "_Response cancelled._" }
              : message,
          ),
        );
      else setError(e instanceof Error ? e.message : "Chat failed");
      await refresh().catch(() => undefined);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  const deleteById = (kind: string, id: string) =>
    run(async () => {
      await json(`/api/${kind}/${id}`, { method: "DELETE" });
      setNotice("Deleted.");
      await refresh();
    });
  const pageLabel = nav.find(([key]) => key === page)?.[1] ?? "Dashboard";
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            OA
          </div>
          <div>
            <strong>Open Agent</strong>
            <span>Console</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {nav.map(([key, label, detail]) => (
            <button
              type="button"
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
              key={key}
            >
              <span>{label}</span>
              <small>{detail}</small>
            </button>
          ))}
        </nav>
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
          <div className="status">
            <i /> Runtime ready
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {loading ? (
          <div className="panel loading-state" role="status">
            <span className="spinner" />
            Loading registry…
          </div>
        ) : (
          <>
            {page === "dashboard" && (
              <Dashboard
                agents={agents}
                models={models}
                skills={skills}
                tools={tools}
                connectors={connectors}
                sessions={sessions}
                runs={runs}
                latestErrors={latestErrors}
                onPage={setPage}
              />
            )}
            {page === "models" && (
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
                onSubmit={(event) => void run(() => saveModel(event))}
              />
            )}
            {page === "agents" && (
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
                onSubmit={(event) => void run(() => saveAgent(event))}
              />
            )}
            {page === "skills" && (
              <SkillsPage
                skills={skills}
                editing={editingSkill}
                onEdit={setEditingSkill}
                onDelete={(skill) =>
                  requestDelete("Delete skill", `Delete “${skill.name}”?`, () =>
                    deleteById("skills", skill.id),
                  )
                }
                onSubmit={(event) => void run(() => saveSkill(event))}
              />
            )}
            {page === "tools" && (
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
                onSubmit={(event) => void run(() => saveTool(event))}
              />
            )}
            {page === "mcp" && (
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
                onSubmit={(event) => void run(() => saveMcp(event))}
              />
            )}
            {page === "memory" && (
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
                    () =>
                      run(async () => {
                        await json(
                          `/api/agents/${selectedMemoryAgent}/memories/${memory.id}`,
                          { method: "DELETE" },
                        );
                        setMemories((rows) =>
                          rows.filter((row) => row.id !== memory.id),
                        );
                        setNotice("Memory deleted.");
                      }),
                  )
                }
                onConnectorSubmit={(event) =>
                  void run(() => saveConnector(event))
                }
                onMemorySubmit={(event) => void run(() => saveMemory(event))}
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
                    () => deleteById("sessions", session.id),
                  )
                }
              />
            )}
            {page === "runs" && (
              <RunsPage
                runs={runs}
                agents={agentNames}
                selectedRun={selectedRun}
                onOpen={(run) => void openRun(run)}
              />
            )}
            {page === "settings" && (
              <SettingsPage
                onExport={() => void run(exportRegistry)}
                onImport={importRegistry}
              />
            )}
          </>
        )}
      </main>
      {chatAgent && (
        <ChatDrawer
          agent={chatAgent}
          messages={messages}
          sessionId={sessionId}
          chatText={chatText}
          busy={busy}
          usage={usage}
          onText={setChatText}
          onClose={closeChat}
          onCancel={() => abortRef.current?.abort()}
          onSubmit={sendMessage}
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

function Dashboard({
  agents,
  models,
  skills,
  tools,
  connectors,
  sessions,
  runs,
  latestErrors,
  onPage,
}: {
  agents: Agent[];
  models: Model[];
  skills: Skill[];
  tools: Tool[];
  connectors: MemoryConnector[];
  sessions: Session[];
  runs: Run[];
  latestErrors: Run[];
  onPage: (page: Page) => void;
}) {
  return (
    <section>
      <div className="section-intro">
        <div>
          <p className="eyebrow">FLIGHT DECK</p>
          <h2>Assemble small agent crews.</h2>
          <p>
            Configure models, prompt modules, actions and durable context in one
            local runtime.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => onPage("agents")}
        >
          Open agent editor
        </button>
      </div>
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
      <div className="grid2">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SYSTEM MAP</p>
              <h2>Runtime inventory</h2>
            </div>
            <span className="tag">
              {sessions.length} sessions · {runs.length} runs
            </span>
          </div>
          <div className="inventory">
            <Inventory
              label="Models"
              value={models.length}
              onClick={() => onPage("models")}
            />
            <Inventory
              label="Agents"
              value={agents.filter((agent) => agent.enabled).length}
              suffix="enabled"
              onClick={() => onPage("agents")}
            />
            <Inventory
              label="Memory connectors"
              value={connectors.length}
              onClick={() => onPage("memory")}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">OPERATIONS</p>
              <h2>Recent errors</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => onPage("runs")}
            >
              View runs
            </button>
          </div>
          {latestErrors.length === 0 ? (
            <EmptyState
              title="No failed runs"
              body="Execution failures will appear here with their correlation IDs."
            />
          ) : (
            latestErrors.map((run) => (
              <div className="row" key={run.id}>
                <div>
                  <strong>
                    {agents.find((agent) => agent.id === run.agentId)?.name ??
                      run.agentId}
                  </strong>
                  <span>{run.error ?? "Unknown error"}</span>
                </div>
                <span className="pill failed">failed</span>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="grid2">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 01</p>
            <h2>Model registry</h2>
          </div>
          <span className="tag">{models.length} configured</span>
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
                <button type="button" onClick={() => onTest(model)}>
                  Test
                </button>
                <button type="button" onClick={() => onEdit(model)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(model)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <ModelForm
        editing={editing}
        onCancel={() => onEdit(null)}
        onSubmit={onSubmit}
      />
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      key={editing?.id ?? "new-model"}
      className="panel form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="MODEL CONFIGURATION"
        title={editing ? "Edit model" : "Add model"}
        editing={Boolean(editing)}
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
        <select
          id="model-provider"
          name="provider"
          defaultValue={editing?.provider ?? "openai"}
        >
          <option value="openai">OpenAI</option>
          <option value="openai-compatible">OpenAI compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google Gemini</option>
          <option value="ollama">Ollama</option>
          <option value="fake">Deterministic fake (CI)</option>
        </select>
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
      <button className="primary">
        {editing ? "Update model" : "Save model"}
      </button>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="grid2">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 02</p>
            <h2>Agent registry</h2>
          </div>
          <button type="button" className="primary compact" onClick={onNew}>
            New agent
          </button>
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
                <code>
                  {agent.skillIds.length} skills · {agent.toolIds.length} tools
                </code>
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={!agent.enabled}
                  onClick={() => onChat(agent)}
                >
                  Chat
                </button>
                <button type="button" onClick={() => onEdit(agent)}>
                  Edit
                </button>
                <button type="button" onClick={() => onDuplicate(agent)}>
                  Duplicate
                </button>
                <button type="button" onClick={() => onEnabled(agent)}>
                  {agent.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(agent)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <AgentForm
        editing={editing}
        models={models}
        skills={skills}
        tools={tools}
        connectors={connectors}
        draftSkillIds={draftSkillIds}
        draftToolIds={draftToolIds}
        promptPreview={promptPreview}
        onCancel={onNew}
        onDraftSkills={onDraftSkills}
        onDraftTools={onDraftTools}
        onPreview={onPreview}
        onSubmit={onSubmit}
      />
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      key={editing?.id ?? "new-agent"}
      className="panel form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="AGENT CONFIGURATION"
        title={editing ? "Edit agent" : "Create agent"}
        editing={Boolean(editing)}
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
        <select
          id="agent-model"
          name="modelRef"
          required
          defaultValue={editing?.modelRef ?? ""}
        >
          <option value="">Select model</option>
          {models.map((model) => (
            <option value={model.id} key={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="agent-memory" label="Memory connector">
        <select
          id="agent-memory"
          name="memoryConnectorId"
          defaultValue={editing?.memoryConnectorId ?? ""}
        >
          <option value="">None</option>
          {connectors.map((connector) => (
            <option value={connector.id} key={connector.id}>
              {connector.name} · {connector.type}
            </option>
          ))}
        </select>
      </Field>
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
        <button
          type="button"
          className="secondary"
          disabled={!editing}
          onClick={onPreview}
        >
          Preview effective prompt
        </button>
        <button className="primary" disabled={!models.length}>
          {editing ? "Update agent" : "Create agent"}
        </button>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="grid2">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 03</p>
            <h2>Skills registry</h2>
          </div>
          <span className="tag">Ordered in agent prompt</span>
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
                <button type="button" onClick={() => onEdit(skill)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(skill)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <form
        key={editing?.id ?? "new-skill"}
        className="panel form"
        noValidate
        onSubmit={onSubmit}
      >
        <FormHeading
          eyebrow="PROMPT MODULE"
          title={editing ? "Edit skill" : "Add skill"}
          editing={Boolean(editing)}
          onCancel={() => onEdit(null)}
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
        <button className="primary">
          {editing ? "Update skill" : "Save skill"}
        </button>
      </form>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="grid2">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 04</p>
            <h2>Tools registry</h2>
          </div>
          <span className="tag">Resolver safeguards active</span>
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
                <button type="button" onClick={() => onEdit(tool)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(tool)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <ToolForm
        editing={editing}
        mcpServers={mcpServers}
        onCancel={() => onEdit(null)}
        onSubmit={onSubmit}
      />
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      key={editing?.id ?? "new-tool"}
      className="panel form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="ACTION DEFINITION"
        title={editing ? "Edit tool" : "Add tool"}
        editing={Boolean(editing)}
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
        <select
          id="tool-mcp"
          name="mcpServerId"
          defaultValue={editing?.mcpServerId ?? ""}
        >
          <option value="">Select only for MCP tools</option>
          {mcpServers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
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
        <button type="submit" name="intent" value="validate" className="secondary">
          Validate configuration
        </button>
        <button className="primary">
        {editing ? "Update tool" : "Save tool"}
        </button>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="grid2">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTRY / 05</p>
            <h2>MCP servers</h2>
          </div>
          <span className="tag">HTTP discovery</span>
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
                <button type="button" onClick={() => onDiscover(server)}>
                  Discover
                </button>
                <button type="button" onClick={() => onEdit(server)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(server)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <form
        key={editing?.id ?? "new-mcp"}
        className="panel form"
        noValidate
        onSubmit={onSubmit}
      >
        <FormHeading
          eyebrow="REMOTE TOOL SOURCE"
          title={editing ? "Edit MCP server" : "Add MCP server"}
          editing={Boolean(editing)}
          onCancel={() => onEdit(null)}
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
        <button className="primary">
          {editing ? "Update server" : "Save server"}
        </button>
      </form>
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
  onConnectorSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMemorySubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RUNTIME CONTEXT</p>
            <h2>Memory connectors</h2>
          </div>
          <span className="tag">No secrets in exports</span>
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
                <button type="button" onClick={() => onEditConnector(item)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDeleteConnector(item)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="add-card"
            onClick={() => onEditConnector(null)}
          >
            + Add connector
          </button>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LONG-TERM MEMORY</p>
              <h2>Saved facts</h2>
            </div>
            <label className="inline-field">
              Agent
              <select
                aria-label="Memory agent"
                value={selectedAgent}
                onChange={(event) => onAgent(event.target.value)}
              >
                <option value="">Select agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
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
                  <button type="button" onClick={() => onEditMemory(memory)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDeleteMemory(memory)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <MemoryForm
          key={editingMemory?.id ?? `${selectedAgent}-new-memory`}
          editing={editingMemory}
          enabled={Boolean(selectedAgent && connector?.type === "sqlite")}
          onCancel={() => onEditMemory(null)}
          onSubmit={onMemorySubmit}
        />
      </div>
      <form
        key={editingConnector?.id ?? "new-connector"}
        className="panel form compact-form"
        noValidate
        onSubmit={onConnectorSubmit}
      >
        <FormHeading
          eyebrow="CONNECTOR CONFIGURATION"
          title={editingConnector ? "Edit connector" : "Add connector"}
          editing={Boolean(editingConnector)}
          onCancel={() => onEditConnector(null)}
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
        <button className="primary">
          {editingConnector ? "Update connector" : "Save connector"}
        </button>
      </form>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      key={editing?.id ?? "new-memory"}
      className="panel form"
      noValidate
      onSubmit={onSubmit}
    >
      <FormHeading
        eyebrow="PERSISTED FACT"
        title={editing ? "Edit memory" : "Add memory"}
        editing={Boolean(editing)}
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
      <button className="primary" disabled={!enabled}>
        {editing ? "Update memory" : "Save memory"}
      </button>
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
          <p className="eyebrow">OBSERVABILITY / 01</p>
          <h2>Sessions</h2>
        </div>
        <span className="tag">Last 100</span>
      </div>
      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          body="Start a chat from the Agents page to create a persisted session."
        />
      ) : (
        sessions.map((session) => (
          <div className="row" key={session.id}>
            <div>
              <strong>{session.title || "Untitled session"}</strong>
              <span>{agents.get(session.agentId) ?? session.agentId}</span>
            </div>
            <div className="actions">
              <small>{formatDate(session.updatedAt)}</small>
              <button type="button" onClick={() => onOpen(session)}>
                Open
              </button>
              <button type="button" onClick={() => onRename(session)}>
                Rename
              </button>
              <button type="button" className="danger" onClick={() => onDelete(session)}>
                Delete
              </button>
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
              <button type="button" onClick={() => onOpen(run)}>
                Inspect
              </button>
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
function SettingsPage({
  onExport,
  onImport,
}: {
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
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
          <button type="button" className="primary" onClick={onExport}>
            Export registry
          </button>
          <label className="file-button">
            Import registry
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
            <strong>Environment-backed credentials and bounded tools</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatDrawer({
  agent,
  messages,
  sessionId,
  chatText,
  busy,
  usage,
  onText,
  onClose,
  onCancel,
  onSubmit,
}: {
  agent: Agent;
  messages: Message[];
  sessionId?: string;
  chatText: string;
  busy: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  onText: (value: string) => void;
  onClose: () => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div
      className="chat-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name} chat`}
    >
      <div className="chat-head">
        <div>
          <span>{sessionId ? "Saved session" : "New agent chat"}</span>
          <strong>{agent.name}</strong>
        </div>
        <button type="button" aria-label="Close chat" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">Start a conversation with this agent.</div>
        )}
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={message.id ?? index}>
            <span>{message.role}</span>
            {message.role === "assistant" ? (
              <div className="markdown">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {message.content ||
                    (busy && index === messages.length - 1 ? "…" : "")}
                </ReactMarkdown>
              </div>
            ) : (
              <p>{message.content}</p>
            )}
          </div>
        ))}
      </div>
      {usage && (
        <div className="usage">
          Tokens: {usage.inputTokens ?? "?"} in · {usage.outputTokens ?? "?"}{" "}
          out · {usage.totalTokens ?? "?"} total
        </div>
      )}
      <form className="composer" noValidate onSubmit={onSubmit}>
        <textarea
          className="resize-none"
          aria-label="Message the agent"
          value={chatText}
          onChange={(event) => onText(event.target.value)}
          rows={2}
          placeholder="Message the agent…"
        />{" "}
        <div className="composer-actions">
          {busy && (
            <button type="button" className="danger-button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="primary" disabled={busy || !chatText.trim()}>
            {busy ? "Running…" : "Send"}
          </button>
        </div>
      </form>
    </div>
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
          <button
            type="button"
            className="secondary"
            ref={cancelRef}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            Delete
          </button>
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
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!title.trim()}>
            Save title
          </button>
        </div>
      </form>
    </div>
  );
}

function FormHeading({
  eyebrow,
  title,
  editing,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  editing: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {editing && (
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      )}
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
      <span>{label}</span>
      {children}
    </label>
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
                <button
                  type="button"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
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
  onClick: () => void;
}) {
  return (
    <button type="button" className="inventory-item" onClick={onClick}>
      <span>{label}</span>
      <strong>
        {value} <small>{suffix}</small>
      </strong>
    </button>
  );
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
