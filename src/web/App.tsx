import { FormEvent, useEffect, useMemo, useState } from 'react';

type Model = { id: string; name: string; provider: string; modelId: string; baseUrl?: string | null; apiKeyEnv: string };
type Agent = { id: string; name: string; description?: string | null; modelRef: string; instructions: string };
type Session = { id: string; agentId: string; title?: string | null; updatedAt: string };
type Run = { id: string; agentId: string; status: string; startedAt: string; error?: string | null };
type Message = { role: 'user' | 'assistant'; content: string };
type Page = 'dashboard' | 'models' | 'agents' | 'sessions' | 'runs';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [chatText, setChatText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    const [modelRows, agentRows, sessionRows, runRows] = await Promise.all([
      json<Model[]>('/api/models'), json<Agent[]>('/api/agents'), json<Session[]>('/api/sessions'), json<Run[]>('/api/runs'),
    ]);
    setModels(modelRows); setAgents(agentRows); setSessions(sessionRows); setRuns(runRows);
  };

  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)); }, []);

  const activeModelNames = useMemo(() => new Map(models.map((model) => [model.id, model.name])), [models]);

  async function createModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined);
    const data = new FormData(event.currentTarget);
    await json('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: data.get('name'), provider: data.get('provider'), modelId: data.get('modelId'), baseUrl: data.get('baseUrl'), apiKeyEnv: data.get('apiKeyEnv'),
    }) });
    event.currentTarget.reset(); await refresh();
  }

  async function createAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined);
    const data = new FormData(event.currentTarget);
    await json('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: data.get('name'), description: data.get('description'), modelRef: data.get('modelRef'), instructions: data.get('instructions'),
    }) });
    event.currentTarget.reset(); await refresh();
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!chatAgent || !chatText.trim() || busy) return;
    const text = chatText.trim(); setChatText(''); setBusy(true); setError(undefined);
    setMessages((current) => [...current, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      const response = await fetch(`/api/agents/${chatAgent.id}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, sessionId }),
      });
      if (!response.ok || !response.body) throw new Error(`Chat request failed: ${response.status}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: ')); if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6)) as { type: string; text?: string; sessionId?: string; message?: string };
          if (payload.type === 'session' && payload.sessionId) setSessionId(payload.sessionId);
          if (payload.type === 'token' && payload.text) setMessages((current) => current.map((m, i) => i === current.length - 1 ? { ...m, content: m.content + payload.text } : m));
          if (payload.type === 'error') throw new Error(payload.message ?? 'Agent error');
        }
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chat failed'); }
    finally { setBusy(false); }
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

      {page === 'dashboard' && <section>
        <div className="cards"><Metric label="Agents" value={agents.length}/><Metric label="Models" value={models.length}/><Metric label="Sessions" value={sessions.length}/><Metric label="Recent runs" value={runs.length}/></div>
        <div className="panel"><h2>Start simple</h2><p>Register an OpenAI or OpenAI-compatible model, create an agent with instructions, then open its chat. Agents are logical runtime instances inside this application — not separate containers.</p></div>
      </section>}

      {page === 'models' && <section className="grid2"><div className="panel"><h2>Model registry</h2>{models.map((m) => <div className="row" key={m.id}><div><strong>{m.name}</strong><span>{m.provider} · {m.modelId}</span></div><code>{m.apiKeyEnv}</code></div>)}</div><form className="panel form" onSubmit={(e) => void createModel(e).catch((x: Error) => setError(x.message))}><h2>Add model</h2><label>Name<input name="name" required placeholder="GPT 5.4"/></label><label>Provider<select name="provider"><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI compatible</option></select></label><label>Model ID<input name="modelId" required placeholder="gpt-5.4"/></label><label>Base URL<input name="baseUrl" placeholder="https://api.example.com/v1"/></label><label>API key environment variable<input name="apiKeyEnv" required defaultValue="OPENAI_API_KEY"/></label><button className="primary">Save model</button></form></section>}

      {page === 'agents' && <section className="grid2"><div className="panel"><div className="section-title"><h2>Agent registry</h2></div>{agents.map((a) => <div className="row agent-row" key={a.id}><div><strong>{a.name}</strong><span>{a.description || 'No description'} · {activeModelNames.get(a.modelRef) ?? 'Unknown model'}</span></div><button onClick={() => { setChatAgent(a); setMessages([]); setSessionId(undefined); }}>Chat</button></div>)}</div><form className="panel form" onSubmit={(e) => void createAgent(e).catch((x: Error) => setError(x.message))}><h2>Create agent</h2><label>Name<input name="name" required placeholder="Architecture Assistant"/></label><label>Description<input name="description" placeholder="Concise architecture guidance"/></label><label>Model<select name="modelRef" required><option value="">Select model</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Instructions<textarea name="instructions" required rows={7} placeholder="You are a helpful assistant..."/></label><button className="primary" disabled={!models.length}>Create agent</button></form></section>}

      {page === 'sessions' && <section className="panel"><h2>Sessions</h2>{sessions.map((s) => <div className="row" key={s.id}><div><strong>{s.title || 'Untitled session'}</strong><span>{agents.find((a) => a.id === s.agentId)?.name ?? s.agentId}</span></div><small>{new Date(s.updatedAt).toLocaleString()}</small></div>)}</section>}
      {page === 'runs' && <section className="panel"><h2>Runs</h2>{runs.map((r) => <div className="row" key={r.id}><div><strong>{agents.find((a) => a.id === r.agentId)?.name ?? r.agentId}</strong><span>{r.error || new Date(r.startedAt).toLocaleString()}</span></div><span className={`pill ${r.status}`}>{r.status}</span></div>)}</section>}
    </main>

    {chatAgent && <div className="chat-drawer"><div className="chat-head"><div><span>Agent chat</span><strong>{chatAgent.name}</strong></div><button onClick={() => setChatAgent(null)}>×</button></div><div className="messages">{messages.length === 0 && <div className="empty">Start a conversation with this agent.</div>}{messages.map((m,i) => <div className={`message ${m.role}`} key={i}><span>{m.role}</span><p>{m.content || (busy && i === messages.length - 1 ? '…' : '')}</p></div>)}</div><form className="composer" onSubmit={sendMessage}><textarea value={chatText} onChange={(e) => setChatText(e.target.value)} rows={2} placeholder="Message the agent..."/><button className="primary" disabled={busy || !chatText.trim()}>{busy ? 'Running…' : 'Send'}</button></form></div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
