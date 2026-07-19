import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import "./styles.css";

type Tab = "batches" | "browse" | "settings";
type JobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
type Model = { id: string; groupId: string; groupName: string; providerName: string; adapter: "code80" | "agent"; model: string; label: string; parallelism: number; sizes: string[]; qualities: string[]; canGenerate: boolean; canEdit: boolean; price: { mode: string; currency: string; amount?: number; note?: string } };
type GroupModel = { id: string; model: string; label: string; sizes: string[]; qualities: string[]; canGenerate: boolean; canEdit: boolean; price: { mode: "per_request" | "token" | "model_quota" | "unknown"; currency: string; amount?: number; note?: string } };
type Group = { id: string; name: string; endpoint: string; parallelism: number; models: GroupModel[]; hasCredential: boolean };
type Version = { id: string; label: string; file: string };
type Job = { id: string; ordinal: number; label: string; prompt: string; references: string[]; outputFile?: string; versions: Version[]; model: Model; state: JobState; progress: number; attempt: number; error?: string; billing: string };
type Batch = { id: string; title: string; summaryPrompt: string; outputDirectory: string; model: Model; jobs: Job[]; state: string; total: number; queued: number; running: number; succeeded: number; failed: number; canceled: number; updatedAt: string };
type Suggestion = { name: string; endpoint: string; parallelism: number; models: GroupModel[] };
type State = { view: { tab: "batches" | "settings"; batchId?: string }; groups: Group[]; choices: Model[]; defaultModelId?: string; batches: Batch[]; activeBatch?: Batch; suggestion: Suggestion; secureStorage: string; platform: string };
type ToolResponse = { structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown>; isError?: boolean; content?: Array<{ type: string; text?: string }> };

const app = new App({ name: "code80-image-workbench", version: "1.0.0" }, {}, { autoResize: true });

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
  return await app.callServerTool({ name, arguments: args }) as ToolResponse;
}

function message(result: ToolResponse): string {
  return result.content?.find((item) => item.type === "text")?.text || (result.isError ? "操作失败" : "操作完成");
}

function useWorkbench() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const selectedBatchId = useRef<string>();

  async function accept(result: ToolResponse): Promise<void> {
    if (result.isError) throw new Error(message(result));
    const payload = result.structuredContent || {};
    if (payload.groups && payload.choices) {
      const next = payload as unknown as State;
      if (selectedBatchId.current && next.batches.some((batch) => batch.id === selectedBatchId.current)) next.activeBatch = next.batches.find((batch) => batch.id === selectedBatchId.current);
      setState(next);
    } else if (payload.batch) {
      const batch = payload.batch as Batch;
      selectedBatchId.current = batch.id;
      setState((current) => current ? { ...current, activeBatch: batch, batches: [batch, ...current.batches.filter((item) => item.id !== batch.id)] } : current);
    }
    setNotice(message(result));
  }

  async function run(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
    setError("");
    try { const result = await call(name, args); await accept(result); return result; }
    catch (failure) { const text = failure instanceof Error ? failure.message : String(failure); setError(text); throw failure; }
  }

  async function refresh(batchId?: string, tab: "batches" | "settings" = "batches"): Promise<void> {
    const result = await call("ui_get_local_state", { batchId, tab });
    await accept(result);
  }

  useEffect(() => {
    app.ontoolresult = (result) => { void accept(result as ToolResponse); };
    void app.connect().then(() => { setConnected(true); return refresh(); }).catch((failure) => setError(`无法连接 Code80 Image：${failure instanceof Error ? failure.message : String(failure)}`));
    return () => { void app.close(); };
  }, []);

  useEffect(() => {
    const batch = state?.activeBatch;
    if (!connected || !batch || !["queued", "running"].includes(batch.state)) return;
    const timer = window.setInterval(() => { void run("ui_get_batch_state", { batchId: batch.id }).catch(() => undefined); }, 1800);
    return () => window.clearInterval(timer);
  }, [connected, state?.activeBatch?.id, state?.activeBatch?.state]);

  return { state, setState, error, notice, run, refresh, selectBatch(id: string) { selectedBatchId.current = id; setState((current) => current ? { ...current, activeBatch: current.batches.find((batch) => batch.id === id) } : current); } };
}

function AppView() {
  const workbench = useWorkbench();
  const [tab, setTab] = useState<Tab>("batches");
  if (!workbench.state) return <main className="boot"><div className="spinner"/><h1>Code80 Image</h1><p>{workbench.error || "正在连接本地工作台…"}</p></main>;
  return <div className="shell">
    <header>
      <div className="brand"><div className="logo-mark">80</div><div><strong>Code80 Image</strong><span>本地批量生图与图片编辑</span></div></div>
      <nav>
        <button className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>任务</button>
        <button className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>浏览</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>设置</button>
      </nav>
    </header>
    {workbench.error && <div className="banner error">{workbench.error}</div>}
    {workbench.notice && !workbench.error && <div className="banner ok">{workbench.notice}</div>}
    {tab === "batches" && <Tasks state={workbench.state} run={workbench.run} selectBatch={workbench.selectBatch}/>} 
    {tab === "browse" && <Library state={workbench.state} run={workbench.run} select={(id) => { workbench.selectBatch(id); setTab("batches"); }}/>} 
    {tab === "settings" && <Settings state={workbench.state} run={workbench.run}/>} 
  </div>;
}

function Tasks({ state, run, selectBatch }: { state: State; run: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse>; selectBatch: (id: string) => void }) {
  const [showCreate, setShowCreate] = useState(!state.activeBatch);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [count, setCount] = useState(1);
  const [modelId, setModelId] = useState(state.defaultModelId || "");
  const [appendPrompt, setAppendPrompt] = useState("");
  const [modifyPrompt, setModifyPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const batch = state.activeBatch;

  async function createBatch() {
    if (!prompt.trim()) return;
    setBusy(true);
    try { await run("create_image_batch", { title: title || undefined, prompt, count, offeringId: modelId || undefined, requestKey: crypto.randomUUID() }); setPrompt(""); setTitle(""); setShowCreate(false); }
    finally { setBusy(false); }
  }

  async function append() {
    if (!batch || !appendPrompt.trim()) return;
    setBusy(true);
    try { await run("append_image_jobs", { batchId: batch.id, jobs: [{ prompt: appendPrompt, referenceImagePaths: [] }], requestKey: crypto.randomUUID() }); setAppendPrompt(""); }
    finally { setBusy(false); }
  }

  async function modify() {
    if (!batch || !selected.length || !modifyPrompt.trim()) return;
    setBusy(true);
    try { await run("modify_selected_images", { batchId: batch.id, imageIds: selected, instructions: modifyPrompt, requestKey: crypto.randomUUID() }); setSelected([]); setModifyPrompt(""); }
    finally { setBusy(false); }
  }

  return <main className="tasks">
    <aside className="batch-list">
      <button className="primary wide" onClick={() => setShowCreate(true)}>＋ 新建批次</button>
      {state.batches.map((item) => <button key={item.id} className={`batch-row ${batch?.id === item.id ? "selected" : ""}`} onClick={() => { selectBatch(item.id); setShowCreate(false); }}>
        <strong>{item.title}</strong><span>{item.succeeded}/{item.total} · {statusText(item.state)}</span>
      </button>)}
    </aside>
    <section className="workspace">
      {showCreate ? <section className="composer-card">
        <div className="section-title"><div><h2>新建生图批次</h2><p>一个批次可以并行生成最多 50 张图片。</p></div></div>
        <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可选"/></label>
        <label>模型<select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">使用默认模型</option>{state.choices.map((model) => <option key={model.id} value={model.id}>{model.providerName} · {model.groupName} · {model.label}</option>)}</select></label>
        <label>数量<input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Math.max(1, Math.min(50, Number(event.target.value))))}/></label>
        <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述想生成的画面…" rows={6}/></label>
        <button className="primary" disabled={busy || !prompt.trim()} onClick={createBatch}>{busy ? "正在创建…" : "创建并开始"}</button>
      </section> : batch ? <>
        <div className="section-title"><div><h2>{batch.title}</h2><p>{batch.model.providerName} · {batch.model.groupName} · {batch.model.label} · {statusText(batch.state)}</p></div><button onClick={() => run("ui_open_batch_folder", { batchId: batch.id })}>打开目录</button></div>
        <div className="progress"><i style={{ width: `${batch.total ? ((batch.succeeded + batch.failed + batch.canceled) / batch.total) * 100 : 0}%` }}/></div>
        <div className="job-grid">{batch.jobs.map((job) => <JobCard key={job.id} batchId={batch.id} job={job} selected={selected.includes(job.id)} toggle={() => setSelected((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} run={run}/>)}</div>
        <section className="bottom-composers">
          <div><h3>新增任务</h3><textarea rows={3} value={appendPrompt} onChange={(event) => setAppendPrompt(event.target.value)} placeholder="输入一个新的独立 Prompt"/><button disabled={busy || !appendPrompt.trim()} onClick={append}>添加到当前批次</button></div>
          <div><h3>修改选中图片 <small>{selected.length ? `已选 ${selected.length} 张` : "双击图片选择"}</small></h3><textarea rows={3} value={modifyPrompt} onChange={(event) => setModifyPrompt(event.target.value)} placeholder="描述修改要求"/><button className="primary" disabled={busy || !selected.length || !modifyPrompt.trim()} onClick={modify}>提交修改</button></div>
        </section>
      </> : <Empty text="还没有任务，创建第一个生图批次。" action={() => setShowCreate(true)}/>} 
    </section>
  </main>;
}

function JobCard({ batchId, job, selected, toggle, run }: { batchId: string; job: Job; selected: boolean; toggle: () => void; run: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse> }) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!job.outputFile) { setPreview(undefined); return; }
    void call("ui_get_image_preview", { batchId, jobId: job.id, full: false }).then((result) => setPreview(result._meta?.dataUrl as string | undefined)).catch(() => undefined);
  }, [batchId, job.id, job.outputFile, job.attempt]);
  return <article className={`job ${selected ? "chosen" : ""}`} onDoubleClick={job.outputFile ? toggle : undefined}>
    <div className="image-frame">{preview ? <img src={preview}/> : <div className={`placeholder ${job.state}`}><span>{job.state === "running" ? `${job.progress}%` : statusText(job.state)}</span></div>}<b>{job.label}</b>{selected && <em>✓</em>}</div>
    <p title={job.prompt}>{job.prompt}</p>
    {job.error && <div className="job-error">{job.error}</div>}
    <div className="job-actions">
      {job.outputFile && <><button onClick={() => run("ui_copy_image_to_clipboard", { batchId, jobId: job.id })}>复制</button><button onClick={() => run("ui_save_image_as", { batchId, jobId: job.id })}>另存</button></>}
      {(["failed", "canceled"] as JobState[]).includes(job.state) && <button onClick={() => run("ui_retry_jobs", { batchId, jobIds: [job.id], allowUnknownCharge: job.billing === "unknown" })}>重试</button>}
      {job.state === "queued" && <button onClick={() => run("ui_cancel_queued_jobs", { batchId, jobIds: [job.id] })}>取消</button>}
      {(["succeeded", "failed", "canceled"] as JobState[]).includes(job.state) && <button className="danger" onClick={() => run("ui_delete_code80_images", { batchId, imageIds: [job.id] })}>删除</button>}
    </div>
  </article>;
}

function Library({ state, run, select }: { state: State; run: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse>; select: (id: string) => void }) {
  return <main className="library"><div className="section-title"><div><h2>本地图库</h2><p>按最近更新时间排列的 Code80 Image 批次。</p></div></div>
    <div className="library-grid">{state.batches.map((batch) => <article key={batch.id} onClick={() => select(batch.id)}><div className="library-preview">{batch.jobs.slice(0, 4).map((job) => <span key={job.id}>{job.label}</span>)}</div><h3>{batch.title}</h3><p>{batch.succeeded} 张完成 · {new Date(batch.updatedAt).toLocaleString()}</p><button className="danger" onClick={(event) => { event.stopPropagation(); void run("ui_delete_image_batch", { batchId: batch.id }); }}>删除批次</button></article>)}</div>
    {!state.batches.length && <Empty text="本地图库为空。"/>}
  </main>;
}

function Settings({ state, run }: { state: State; run: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse> }) {
  const [selectedId, setSelectedId] = useState(state.groups[0]?.id || "new");
  const selected = state.groups.find((group) => group.id === selectedId);
  const initial = selected || { id: undefined, name: state.suggestion.name, endpoint: state.suggestion.endpoint, parallelism: state.suggestion.parallelism, models: state.suggestion.models, hasCredential: false };
  const [draft, setDraft] = useState({ ...initial, models: structuredClone(initial.models), credential: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const item = state.groups.find((group) => group.id === selectedId); const value = item || { id: undefined, name: state.suggestion.name, endpoint: state.suggestion.endpoint, parallelism: state.suggestion.parallelism, models: state.suggestion.models, hasCredential: false }; setDraft({ ...value, models: structuredClone(value.models), credential: "" }); }, [selectedId, state.groups.length]);
  async function perform(name: string, args: Record<string, unknown>) { setBusy(true); try { await run(name, args); } finally { setBusy(false); } }
  function updateModel(index: number, change: Partial<GroupModel>) { setDraft((current) => ({ ...current, models: current.models.map((model, position) => position === index ? { ...model, ...change } : model) })); }
  return <main className="settings">
    <aside><button className="primary wide" onClick={() => setSelectedId("new")}>＋ 新建分组</button>{state.groups.map((group) => <button className={selectedId === group.id ? "selected" : ""} key={group.id} onClick={() => setSelectedId(group.id)}><strong>Code80</strong><span>{group.name} · {group.hasCredential ? "已保存密钥" : "缺少密钥"}</span></button>)}</aside>
    <section>
      <div className="section-title"><div><h2>Code80 · {draft.name || "新分组"}</h2><p>每个分组独立保存 API Key，并配置自己的模型。</p></div></div>
      <div className="form-grid"><label>分组名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label><label>并发数<input type="number" min={1} max={12} value={draft.parallelism} onChange={(event) => setDraft({ ...draft, parallelism: Number(event.target.value) })}/></label></div>
      <label>Code80 API 地址<input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}/></label>
      <label>API Key <small>{draft.hasCredential ? `留空保留 ${state.secureStorage} 中的现有密钥` : `将保存到 ${state.secureStorage}`}</small><input type="password" value={draft.credential} onChange={(event) => setDraft({ ...draft, credential: event.target.value })} placeholder={draft.hasCredential ? "•••••••• 已安全保存" : "输入该分组的 API Key"}/></label>
      <div className="connection-actions"><button disabled={busy} onClick={() => perform("ui_test_provider_profile", { endpoint: draft.endpoint, groupId: draft.id, credential: draft.credential || undefined })}>测试连接</button><button className="primary" disabled={busy} onClick={() => perform("ui_save_provider_profile", { id: draft.id, name: draft.name, endpoint: draft.endpoint, parallelism: draft.parallelism, credential: draft.credential || undefined, models: draft.models })}>保存分组</button></div>
      <div className="model-heading"><h3>模型</h3><button onClick={() => setDraft({ ...draft, models: [...draft.models, { id: "", model: "", label: "", sizes: [], qualities: [], canGenerate: true, canEdit: true, price: { mode: "unknown", currency: "CNY" } }] })}>＋ 添加模型</button></div>
      <div className="models">{draft.models.map((model, index) => <article key={`${model.id}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><label>显示名称<input value={model.label} onChange={(event) => updateModel(index, { label: event.target.value })}/></label><label>Code80 模型 ID<input value={model.model} onChange={(event) => updateModel(index, { model: event.target.value })}/></label><button className="icon danger" onClick={() => setDraft({ ...draft, models: draft.models.filter((_, position) => position !== index) })}>×</button></article>)}</div>
      <div className="default-model"><label>默认模型<select value={state.defaultModelId || ""} onChange={(event) => event.target.value && void perform("ui_set_default_offering", { offeringId: event.target.value })}><option value="">请选择</option>{state.choices.map((model) => <option key={model.id} value={model.id}>{model.providerName} · {model.groupName} · {model.label}</option>)}</select></label></div>
      {draft.id && <button className="danger" onClick={() => perform("ui_delete_provider_profile", { id: draft.id })}>删除此分组</button>}
    </section>
  </main>;
}

function Empty({ text, action }: { text: string; action?: () => void }) { return <div className="empty"><div>▧</div><p>{text}</p>{action && <button className="primary" onClick={action}>开始创建</button>}</div>; }
function statusText(value: string): string { return ({ queued: "等待中", running: "生成中", completed: "已完成", partial: "部分完成", failed: "失败", canceled: "已取消", succeeded: "已完成" } as Record<string, string>)[value] || value; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><AppView/></React.StrictMode>);
