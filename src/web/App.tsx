import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { parseSseBuffer } from './sse';

type Model = {
  id: string;
  name: string;
  provider: 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama';
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

type Agent = {
  id: string;
  name: string;
  description?: string | null;
  modelRef: string;
  instructions: string;
  enabled: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  maxModelCalls: number;
  maxToolCalls: number;
};

type Session = { id: string; agentId: string; title?: string | null; updatedAt: string };
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
};
type Message = { id?: string; role: 'user' | 'assistant'; content: string; createdAt?: string };
type PageResponse<T> = { items: T[]; offset: number; limit: number };
type Page = 'dashboard' | 'models' | 'agents' | 'sessions' | 'runs';

type ModelForm = Omit<Model, 'id' | 'enabled'>;
type AgentForm = Omit<Agent, 'id' | 'enabled'>;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function optionalNumber(data: FormData, name: string): number | undefined {
  const value = String(data.get(name) ?? '').trim();
  return value ? Number(value) : undefined;
}

function requiredNumber(data: FormData, name: string, fallback: number): number {
  return optionalNumber(data, name) ?? fallback;
}

export function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [chatText, setChatText] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);

  const refresh = async () => {
    const [modelRows, agentRows, sessionPage, runPage] = await Promise.all([
      json<Model[]>('/api/models'),
      json<Agent[]>('/api/agents'),
      json<PageResponse<Session>>('/api/sessions?limit=100'),
      json<PageResponse<Run>>('/api/runs?limit=100'),
    ]);
    setModels(modelRows);
    setAgents(agentRows);
    setSessions(sessionPage.items);
    setRuns(runPage.items);
  };

  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)); }, []);

  const activeModelNames = useMemo(() => new Map(models.map((model) => [model.id, model.name])), [models]);
  const latestErrors = useMemo(() => runs.filter((run) => run.status === 'failed').slice(0, 5), [runs]);

  async function saveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined); setNotice(undefined);
    const data = new FormData(event.currentTarget);
    const body: ModelForm = {
      name: String(data.get('name') ?? ''),
      provider: String(data.get('provider') ?? 'openai') as Model['provider'],
      modelId: String(data.get('modelId') ?? ''),
      baseUrl: String(data.get('baseUrl') ?? ''),
      apiKeyEnv: String(data.get('apiKeyEnv') ?? ''),
      temperature: optionalNumber(data, 'temperature'),
      maxTokens: optionalNumber(data, 'maxTokens'),
      capabilities: data.getAll('capabilities').map(String),
      timeoutMs: requiredNumber(data, 'timeoutMs', 60_000),
      maxRetries: requiredNumber(data, 'maxRetries', 2),
    };
    if (editingModel) {
      await json(`/api/models/${editingModel.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setEditingModel(null);
      setNotice('Model updated.');
    } else {
      await json('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      event.currentTarget.reset();
      setNotice('Model added.');
    }
    await refresh();
  }

  async function testModel(model: Model) {
    setError(undefined); setNotice(`Testing ${model.name}…`);
    try {
      const result = await json<{ ok: boolean; latencyMs: number }>(`/api/models/${model.id}/test`, { method: 'POST' });
      setNotice(`${model.name} connection succeeded in ${result.latencyMs} ms.`);
    } catch (e) {
      setNotice(undefined); setError(e instanceof Error ? e.message : 'Connection test failed');
    }
  }

  async function deleteModel(model: Model) {
    if (!window.confirm(`Delete model “${model.name}”? Models referenced by agents cannot be deleted.`)) return;
    await json<void>(`/api/models/${model.id}`, { method: 'DELETE' });
    if (editingModel?.id === model.id) setEditingModel(null);
    await refresh();
  }

  async function saveAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined); setNotice(undefined);
    const data = new FormData(event.currentTarget);
    const body: AgentForm = {
      name: String(data.get('name') ?? ''),
      description: String(data.get('description') ?? ''),
      modelRef: String(data.get('modelRef') ?? ''),
      instructions: String(data.get('instructions') ?? ''),
      temperature: optionalNumber(data, 'temperature'),
      maxTokens: optionalNumber(data, 'maxTokens'),
      maxModelCalls: requiredNumber(data, 'maxModelCalls', 6),
      maxToolCalls: requiredNumber(data, 'maxToolCalls', 10),
    };
    if (editingAgent) {
      await json(`/api/agents/${editingAgent.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setEditingAgent(null);
      setNotice('Agent updated. Runtime cache invalidated.');
    } else {
      await json('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      event.currentTarget.reset();
      setNotice('Agent created.');
    }
    await refresh();
  }

  async function setAgentEnabled(agent: Agent, enabled: boolean) {
    await json(`/api/agents/${agent.id}/enabled`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    await refresh();
  }

  async function duplicateAgent(agent: Agent) {
    await json(`/api/agents/${agent.id}/duplicate`, { method: 'POST' });
    setNotice(`Duplicated ${agent.name}; the copy is disabled by default.`);
    await refresh();
  }

  async function deleteAgent(agent: Agent) {
    if (!window.confirm(`Delete agent “${agent.name}”? Its sessions, messages, and run history will also be deleted.`)) return;
    await json<void>(`/api/agents/${agent.id}`, { method: 'DELETE' });
    if (chatAgent?.id === agent.id) closeChat();
    if (editingAgent?.id === agent.id) setEditingAgent(null);
    await refresh();
  }

  function startNewChat(agent: Agent) {
    setChatAgent(agent); setMessages([]); setSessionId(undefined); setUsage(undefined); setError(undefined);
  }

  async function reopenSession(session: Session) {
    const agent = agents.find((candidate) => candidate.id === session.agentId);
    if (!agent) { setError('The agent for this session no longer exists.'); return; }
    const stored = await json<Array<{ id: string; role: string; content: string; createdAt: string }>>(`/api/sessions/${session.id}/messages`);
    setMessages(stored.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({
      id: message.id, role: message.role as Message['role'], content: message.content, createdAt: message.createdAt,
    })));
    setSessionId(session.id); setChatAgent(agent); setUsage(undefined); setError(undefined);
  }

  function cancelChat() {
    abortRef.current?.abort();
  }

  function closeChat() {
    abortRef.current?.abort();
    setChatAgent(null); setMessages([]); setSessionId(undefined); setUsage(undefined); setBusy(false);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!chatAgent || !chatText.trim() || busy) return;
    const text = chatText.trim();
    const controller = new AbortController();
    abortRef.current = controller;
    setChatText(''); setBusy(true); setError(undefined); setUsage(undefined);
    setMessages((current) => [...current, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      const response = await fetch(`/api/agents/${chatAgent.id}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ message: text, sessionId }),
      });
      if (!response.ok || !response.body) throw new Error(`Chat request failed: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);
        buffer = parsed.rest;
        for (const payload of parsed.events) {
          if (payload.type === 'session') setSessionId(payload.sessionId);
          if (payload.type === 'token') setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: message.content + payload.text } : message));
          if (payload.type === 'usage') setUsage(payload);
          if (payload.type === 'error') throw new Error(payload.message);
        }
      }
      await refresh();
    } catch (e) {
      if (controller.signal.aborted) {
        setMessages((current) => current.map((message, index) => index === current.length - 1 && !message.content ? { ...message, content: '_Response cancelled._' } : message));
      } else {
        setError(e instanceof Error ? e.message : 'Chat failed');
      }
      await refresh().catch(() => undefined);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  const nav: Array<[Page, string]> = [['dashboard','Dashboard'],['models','Models'],['agents','Agents'],['sessions','Sessions'],['runs','Runs']];

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="logo">OA</div><div><strong>Open Agent</strong><span>Console</span></div></div>
      <nav>{nav.map(([key,label]) => <button className={page === key ? 'active' : ''} onClick={() => setPage(key)} key={key}>{label}</button>)}</nav>
      <div className="sidebar-foot">Single runtime · SQLite · LangChain</div>
    </aside>
    <main>
      <header><div><p className="eyebrow">SELF-CONTAINED AGENT RUNTIME</p><h1>{nav.find(([key]) => key === page)?.[1]}</h1></div><div className="status"><i /> Runtime ready</div></header>
      {error && <div className="error">{error}<button onClick={() => setError(undefined)}>×</button></div>}
      {notice && <div className="notice">{notice}<button onClick={() => setNotice(undefined)}>×</button></div>}

      {page === 'dashboard' && <section>
        <div className="cards"><Metric label="Agents" value={agents.length}/><Metric label="Models" value={models.length}/><Metric label="Sessions" value={sessions.length}/><Metric label="Recent runs" value={runs.length}/></div>
        <div className="grid2">
          <div className="panel"><h2>Start simple</h2><p>Register a model, create a lightweight agent, and chat with it. Agents remain logical runtime instances inside one application and one Docker image.</p></div>
          <div className="panel"><h2>Recent errors</h2>{latestErrors.length === 0 ? <p>No recent failed runs.</p> : latestErrors.map((run) => <div className="row" key={run.id}><div><strong>{agents.find((a) => a.id === run.agentId)?.name ?? run.agentId}</strong><span>{run.error ?? 'Unknown error'}</span></div></div>)}</div>
        </div>
      </section>}

      {page === 'models' && <section className="grid2"><div className="panel"><h2>Model registry</h2>{models.map((model) => <div className="row registry-row" key={model.id}><div><strong>{model.name}</strong><span>{model.provider} · {model.modelId} · {model.capabilities.join(', ')}</span><code>{model.apiKeyEnv || 'No credential'}</code></div><div className="actions"><button onClick={() => void testModel(model)}>Test</button><button onClick={() => setEditingModel(model)}>Edit</button><button className="danger" onClick={() => void deleteModel(model).catch((e: Error) => setError(e.message))}>Delete</button></div></div>)}</div><form key={editingModel?.id ?? 'new-model'} className="panel form" onSubmit={(e) => void saveModel(e).catch((x: Error) => setError(x.message))}><div className="section-title"><h2>{editingModel ? 'Edit model' : 'Add model'}</h2>{editingModel && <button type="button" onClick={() => setEditingModel(null)}>Cancel</button>}</div><label>Name<input name="name" required defaultValue={editingModel?.name ?? ''}/></label><label>Provider<select name="provider" defaultValue={editingModel?.provider ?? 'openai'}><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI compatible</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option><option value="ollama">Ollama</option></select></label><label>Model ID<input name="modelId" required defaultValue={editingModel?.modelId ?? ''}/></label><label>Base URL<input name="baseUrl" defaultValue={editingModel?.baseUrl ?? ''} placeholder="Required for OpenAI-compatible; optional for Ollama"/></label><label>API key environment variable<input name="apiKeyEnv" defaultValue={editingModel?.apiKeyEnv ?? 'OPENAI_API_KEY'} placeholder="May be blank for Ollama"/></label><div className="form-grid"><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue={editingModel?.temperature ?? ''}/></label><label>Max tokens<input name="maxTokens" type="number" min="1" defaultValue={editingModel?.maxTokens ?? ''}/></label><label>Timeout (ms)<input name="timeoutMs" type="number" min="1000" max="300000" defaultValue={editingModel?.timeoutMs ?? 60000}/></label><label>Retries<input name="maxRetries" type="number" min="0" max="10" defaultValue={editingModel?.maxRetries ?? 2}/></label></div><fieldset><legend>Capabilities</legend>{['streaming','tools','vision','audio','structured-output'].map((capability) => <label className="check" key={capability}><input type="checkbox" name="capabilities" value={capability} defaultChecked={editingModel ? editingModel.capabilities.includes(capability) : capability === 'streaming'}/>{capability}</label>)}</fieldset><button className="primary">{editingModel ? 'Update model' : 'Save model'}</button></form></section>}

      {page === 'agents' && <section className="grid2"><div className="panel"><h2>Agent registry</h2>{agents.map((agent) => <div className="row registry-row" key={agent.id}><div><strong>{agent.name} {!agent.enabled && <span className="muted-inline">(disabled)</span>}</strong><span>{agent.description || 'No description'} · {activeModelNames.get(agent.modelRef) ?? 'Unknown model'}</span></div><div className="actions"><button disabled={!agent.enabled} onClick={() => startNewChat(agent)}>Chat</button><button onClick={() => setEditingAgent(agent)}>Edit</button><button onClick={() => void duplicateAgent(agent).catch((e: Error) => setError(e.message))}>Duplicate</button><button onClick={() => void setAgentEnabled(agent, !agent.enabled).catch((e: Error) => setError(e.message))}>{agent.enabled ? 'Disable' : 'Enable'}</button><button className="danger" onClick={() => void deleteAgent(agent).catch((e: Error) => setError(e.message))}>Delete</button></div></div>)}</div><form key={editingAgent?.id ?? 'new-agent'} className="panel form" onSubmit={(e) => void saveAgent(e).catch((x: Error) => setError(x.message))}><div className="section-title"><h2>{editingAgent ? 'Edit agent' : 'Create agent'}</h2>{editingAgent && <button type="button" onClick={() => setEditingAgent(null)}>Cancel</button>}</div><label>Name<input name="name" required defaultValue={editingAgent?.name ?? ''}/></label><label>Description<input name="description" defaultValue={editingAgent?.description ?? ''}/></label><label>Model<select name="modelRef" required defaultValue={editingAgent?.modelRef ?? ''}><option value="">Select model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Instructions<textarea name="instructions" required rows={7} defaultValue={editingAgent?.instructions ?? ''}/></label><div className="form-grid"><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue={editingAgent?.temperature ?? ''}/></label><label>Max tokens<input name="maxTokens" type="number" min="1" defaultValue={editingAgent?.maxTokens ?? ''}/></label><label>Max model calls<input name="maxModelCalls" type="number" min="1" max="50" defaultValue={editingAgent?.maxModelCalls ?? 6}/></label><label>Max tool calls<input name="maxToolCalls" type="number" min="1" max="100" defaultValue={editingAgent?.maxToolCalls ?? 10}/></label></div><button className="primary" disabled={!models.length}>{editingAgent ? 'Update agent' : 'Create agent'}</button></form></section>}

      {page === 'sessions' && <section className="panel"><h2>Sessions</h2>{sessions.map((session) => <div className="row" key={session.id}><div><strong>{session.title || 'Untitled session'}</strong><span>{agents.find((agent) => agent.id === session.agentId)?.name ?? session.agentId}</span></div><div className="actions"><small>{new Date(session.updatedAt).toLocaleString()}</small><button onClick={() => void reopenSession(session).catch((e: Error) => setError(e.message))}>Open</button></div></div>)}</section>}
      {page === 'runs' && <section className="panel"><h2>Runs</h2>{runs.map((run) => <div className="row" key={run.id}><div><strong>{agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}</strong><span>{run.error || `${new Date(run.startedAt).toLocaleString()}${run.totalTokens != null ? ` · ${run.totalTokens} tokens` : ''}`}</span>{run.correlationId && <code>{run.correlationId}</code>}</div><span className={`pill ${run.status}`}>{run.status}</span></div>)}</section>}
    </main>

    {chatAgent && <div className="chat-drawer"><div className="chat-head"><div><span>{sessionId ? 'Session' : 'New agent chat'}</span><strong>{chatAgent.name}</strong></div><button onClick={closeChat}>×</button></div><div className="messages">{messages.length === 0 && <div className="empty">Start a conversation with this agent.</div>}{messages.map((message,index) => <div className={`message ${message.role}`} key={message.id ?? index}><span>{message.role}</span>{message.role === 'assistant' ? <div className="markdown"><ReactMarkdown rehypePlugins={[rehypeSanitize]}>{message.content || (busy && index === messages.length - 1 ? '…' : '')}</ReactMarkdown></div> : <p>{message.content}</p>}</div>)}</div>{usage && <div className="usage">Tokens: {usage.inputTokens ?? '?'} in · {usage.outputTokens ?? '?'} out · {usage.totalTokens ?? '?'} total</div>}<form className="composer" onSubmit={sendMessage}><textarea value={chatText} onChange={(e) => setChatText(e.target.value)} rows={2} placeholder="Message the agent..."/><div className="composer-actions">{busy && <button type="button" className="danger-button" onClick={cancelChat}>Cancel</button>}<button className="primary" disabled={busy || !chatText.trim()}>{busy ? 'Running…' : 'Send'}</button></div></form></div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
