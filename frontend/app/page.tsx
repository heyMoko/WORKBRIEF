"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Branch = { branch: string; previous_amount: number; current_amount: number; change: number };
type Report = { previous_month: string; current_month: string; branches: Branch[] };
type AIUsage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  elapsed_ms: number;
  estimated_cost_usd: number | null;
};
type AIReport = { report: Report; draft: string; usage: AIUsage };
type UsageHistory = {
  summary: { calls: number; total_tokens: number; estimated_cost_usd: number };
  recent: Array<AIUsage & { created_at: string }>;
};
type DocumentUpload = { document_id: number; filename: string; chunks: number; index_status: "queued" | "not_queued"; job_id?: string };
type DocumentIndexStatus = { document_id: number; filename?: string; index_status: "queued" | "processing" | "ready" | "failed" | "not_queued"; index_error: string | null; indexed_at?: string | null };
type StoredDocument = DocumentIndexStatus & { index_job_id?: string | null; created_at: string };
type DocumentSource = {
  document_name: string;
  chunk_index: number;
  content: string;
  score: number;
};
type DocumentSearch = { query: string; terms: string[]; mode: "keyword" | "semantic"; sources: DocumentSource[] };
type DocumentAnswer = {
  query: string;
  mode: "keyword" | "semantic";
  answer: string;
  citations: number[];
  sources: DocumentSource[];
  usage: AIUsage | null;
};
type AgentAnswer = {
  answer: string;
  tool_trace: Array<{ tool: "get_sales_report" | "search_work_documents"; arguments: Record<string, unknown> }>;
  usage: AIUsage;
};
type AgentTraceHistory = { summary: { calls: number; total_tokens: number; estimated_cost_usd: number }; recent: Array<{ created_at: string; tools: string[]; model: string; total_tokens: number; elapsed_ms: number; estimated_cost_usd: number | null }> };
type User = { id: number; email: string; display_name: string };
type LoginResponse = { access_token: string; token_type: string; user: User };
type ApiError = { detail?: string | string[] | Array<{ msg?: string }> };
const money = (amount: number) => `${new Intl.NumberFormat("ko-KR").format(amount)}원`;

function authenticatedFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  const token = sessionStorage.getItem("workbrief_access_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

function errorMessage(data: ApiError, fallback: string) {
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => (typeof item === "string" ? item : item.msg ?? "입력값을 확인해주세요.")).join(" / ");
  }
  return fallback;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<"agent" | "knowledge" | "report">("agent");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [aiError, setAiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsage | null>(null);
  const [usageHistory, setUsageHistory] = useState<UsageHistory | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentStatus, setDocumentStatus] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [documentIndex, setDocumentIndex] = useState<DocumentIndexStatus | null>(null);
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [question, setQuestion] = useState("");
  const [documentSearch, setDocumentSearch] = useState<DocumentSearch | null>(null);
  const [documentAnswer, setDocumentAnswer] = useState<DocumentAnswer | null>(null);
  const [agentQuestion, setAgentQuestion] = useState("");
  const [agentAnswer, setAgentAnswer] = useState<AgentAnswer | null>(null);
  const [agentError, setAgentError] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentHistory, setAgentHistory] = useState<AgentTraceHistory | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("workbrief_access_token");
    if (!token) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => response.ok ? setUser((await response.json()) as User) : sessionStorage.removeItem("workbrief_access_token"))
      .catch(() => sessionStorage.removeItem("workbrief_access_token"));
  }, []);

  useEffect(() => {
    if (user) refreshDocuments();
    else setStoredDocuments([]);
  }, [user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true); setAuthError("");
    try {
      if (authMode === "register") {
        const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, display_name: authName, password: authPassword }) });
        const data: User | ApiError = await response.json();
        if (!response.ok) { setAuthError(errorMessage(data as ApiError, "회원가입에 실패했어요.")); return; }
        setAuthMode("login"); setAuthPassword(""); setAuthError("회원가입이 완료됐어요. 같은 이메일로 로그인해주세요."); return;
      }
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, password: authPassword }) });
      const data: LoginResponse | ApiError = await response.json();
      if (!response.ok) { setAuthError(errorMessage(data as ApiError, "로그인에 실패했어요.")); return; }
      const result = data as LoginResponse;
      sessionStorage.setItem("workbrief_access_token", result.access_token);
      setUser(result.user); setAuthPassword("");
    } catch { setAuthError("로그인 서버와 연결하지 못했어요."); }
    finally { setAuthLoading(false); }
  }

  function logout() { sessionStorage.removeItem("workbrief_access_token"); setUser(null); setDocumentSearch(null); setDocumentAnswer(null); setAgentAnswer(null); setAgentHistory(null); setUsageHistory(null); setReport(null); setDraft(""); setDocumentId(null); setDocumentIndex(null); setDocumentStatus(""); }

  async function refreshUsageHistory() {
    try {
      const response = await authenticatedFetch("/api/report", { cache: "no-store" });
      if (response.ok) setUsageHistory((await response.json()) as UsageHistory);
    } catch {
      // 통계 화면을 불러오지 못해도 CSV 분석과 초안 작성은 계속 쓸 수 있다.
    }
  }

  async function refreshDocuments() {
    setDocumentsLoading(true);
    try {
      const response = await authenticatedFetch("/api/documents", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { documents: StoredDocument[] };
        setStoredDocuments(data.documents);
      }
    } finally { setDocumentsLoading(false); }
  }

  async function deleteStoredDocument(document: StoredDocument) {
    if (!window.confirm(`'${document.filename}' (번호 ${document.document_id}) 문서를 삭제할까요? 문서 조각과 AI 검색 데이터도 삭제됩니다.`)) return;
    try {
      const response = await authenticatedFetch(`/api/documents/${document.document_id}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json() as ApiError; setDocumentError(errorMessage(data, "문서 삭제에 실패했어요.")); return; }
      if (documentId === document.document_id) { setDocumentId(null); setDocumentIndex(null); setSearchMode("keyword"); setDocumentSearch(null); setDocumentAnswer(null); }
      setDocumentError(""); setDocumentStatus("문서를 삭제했어요.");
      await refreshDocuments();
    } catch { setDocumentError("문서 삭제 중 연결 문제가 생겼어요."); }
  }

  function selectStoredDocument(document: StoredDocument) {
    setDocumentId(document.document_id);
    setDocumentIndex(document);
    setDocumentError("");
    setDocumentStatus(document.index_status === "ready"
      ? `'${document.filename}' 문서는 AI 의미 검색 준비가 끝났어요.`
      : `'${document.filename}' 문서를 선택했어요. 현재 상태: ${document.index_status}.`);
    if (document.index_status === "ready") setSearchMode("semantic");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setReport(null);
    setDraft("");
    setError("");
    setAiError("");
    setAiUsage(null);
  }

  function chooseDocument(event: ChangeEvent<HTMLInputElement>) {
    setDocumentFile(event.target.files?.[0] ?? null);
    setDocumentStatus("");
    setDocumentError("");
    setDocumentId(null);
    setDocumentIndex(null);
    setDocumentSearch(null);
    setDocumentAnswer(null);
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile) {
      setDocumentError("먼저 .txt 또는 .md 문서를 선택해주세요.");
      return;
    }
    const form = new FormData();
    form.append("file", documentFile);
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const response = await authenticatedFetch("/api/documents/upload", { method: "POST", body: form });
      const data: DocumentUpload | ApiError = await response.json();
      if (!response.ok) {
        setDocumentError(errorMessage(data as ApiError, "문서 등록에 실패했어요."));
        return;
      }
      const result = data as DocumentUpload;
      setDocumentId(result.document_id);
      setDocumentIndex({ document_id: result.document_id, filename: result.filename, index_status: result.index_status, index_error: null });
      setDocumentStatus(result.index_status === "queued"
        ? `'${result.filename}' 문서를 ${result.chunks}개 조각으로 등록했어요. AI 의미 검색은 뒤에서 준비 중이고, 단어 검색은 지금 바로 쓸 수 있어요.`
        : `'${result.filename}' 문서를 ${result.chunks}개 조각으로 등록했어요. 단어 검색은 지금 바로 쓸 수 있어요.`);
      setDocumentSearch(null);
      setDocumentAnswer(null);
      await refreshDocuments();
    } catch {
      setDocumentError("문서 등록 중 연결 문제가 생겼어요.");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function searchDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) {
      setDocumentError("문서에 물어볼 질문을 입력해주세요.");
      return;
    }
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const response = await authenticatedFetch(`/api/documents/search?q=${encodeURIComponent(question)}&mode=${searchMode}`);
      const data: DocumentSearch | ApiError = await response.json();
      if (!response.ok) {
        setDocumentError(errorMessage(data as ApiError, "문서 검색에 실패했어요."));
        return;
      }
      setDocumentSearch(data as DocumentSearch);
      setDocumentAnswer(null);
    } catch {
      setDocumentError("문서 검색 중 연결 문제가 생겼어요.");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function refreshAgentHistory() {
    const response = await authenticatedFetch("/api/agent/traces", { cache: "no-store" });
    if (response.ok) setAgentHistory((await response.json()) as AgentTraceHistory);
  }

  async function askWorkAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agentQuestion.trim()) {
      setAgentError("업무 질문을 입력해주세요.");
      return;
    }
    setAgentLoading(true);
    setAgentError("");
    setAgentAnswer(null);
    try {
      const response = await authenticatedFetch("/api/agent/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: agentQuestion }),
      });
      const data: AgentAnswer | ApiError = await response.json();
      if (!response.ok) {
        setAgentError(errorMessage(data as ApiError, "업무 에이전트 호출에 실패했어요."));
        return;
      }
      setAgentAnswer(data as AgentAnswer);
      await refreshAgentHistory();
    } catch {
      setAgentError("업무 에이전트 호출 중 연결 문제가 생겼어요.");
    } finally {
      setAgentLoading(false);
    }
  }

  async function createDocumentAnswer() {
    if (!question.trim()) {
      setDocumentError("문서에 물어볼 질문을 입력해주세요.");
      return;
    }
    setDocumentLoading(true);
    setDocumentError("");
    setDocumentSearch(null);
    // Make an empty speech bubble first, so the user can see the answer arriving.
    setDocumentAnswer({ query: question, mode: searchMode, answer: "", citations: [], sources: [], usage: null });
    try {
      const response = await authenticatedFetch("/api/documents/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ query: question, mode: searchMode }),
      });
      if (!response.ok || !response.body) {
        const data: ApiError = await response.json();
        setDocumentAnswer(null);
        setDocumentError(errorMessage(data, "AI 답변 생성에 실패했어요."));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedError = false;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          const eventName = message.match(/^event: (.+)$/m)?.[1];
          const dataLine = message.match(/^data: (.+)$/m)?.[1];
          if (!eventName || !dataLine) continue;
          const data = JSON.parse(dataLine) as { text?: string; detail?: string } & DocumentAnswer;
          if (eventName === "delta" && data.text) {
            setDocumentAnswer((current) => current ? { ...current, answer: current.answer + data.text } : current);
          }
          if (eventName === "done") setDocumentAnswer(data as DocumentAnswer);
          if (eventName === "error") {
            receivedError = true;
            setDocumentAnswer(null);
            setDocumentError(data.detail ?? "AI 답변 생성에 실패했어요.");
          }
        }
        if (done) break;
      }
      if (!receivedError) await refreshUsageHistory();
    } catch {
      setDocumentAnswer(null);
      setDocumentError("AI 답변을 받는 중 연결 문제가 생겼어요.");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function refreshDocumentIndex() {
    if (!documentId) return;
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const response = await authenticatedFetch(`/api/documents/${documentId}/status`, { cache: "no-store" });
      const data: DocumentIndexStatus | ApiError = await response.json();
      if (!response.ok) { setDocumentError(errorMessage(data as ApiError, "AI 준비 상태를 불러오지 못했어요.")); return; }
      const result = data as DocumentIndexStatus;
      setDocumentIndex(result);
      await refreshDocuments();
      if (result.index_status === "ready") {
        setSearchMode("semantic");
        setDocumentStatus("AI 의미 검색 준비가 끝났어요. 이제 표현이 달라도 비슷한 뜻을 찾아볼 수 있어요.");
      } else if (result.index_status === "failed") {
        setDocumentError(result.index_error ?? "AI 의미 검색 준비에 실패했어요. 다시 요청해주세요.");
      } else {
        setDocumentStatus(result.index_status === "processing" ? "AI가 문서 뜻을 읽고 있어요. 잠시 뒤 상태를 새로고침해주세요." : "AI 의미 검색을 준비하기 위해 대기열에 넣었어요. 잠시 뒤 상태를 새로고침해주세요.");
      }
    } catch { setDocumentError("AI 준비 상태를 확인하는 중 연결 문제가 생겼어요."); }
    finally { setDocumentLoading(false); }
  }

  async function indexDocument() {
    if (!documentId) { setDocumentError("먼저 문서를 등록해주세요."); return; }
    setDocumentLoading(true); setDocumentError("");
    try {
      const response = await authenticatedFetch(`/api/documents/${documentId}/index`, { method: "POST" });
      const data: DocumentIndexStatus | ApiError = await response.json();
      if (!response.ok) { setDocumentError(errorMessage(data as ApiError, "AI 준비 재요청에 실패했어요.")); return; }
      const result = data as DocumentIndexStatus;
      setDocumentIndex(result);
      await refreshDocuments();
      setDocumentStatus(result.index_status === "ready" ? "이미 AI 의미 검색 준비가 끝난 문서예요." : "AI 의미 검색을 다시 대기열에 넣었어요. 잠시 뒤 상태를 새로고침해주세요.");
    } catch { setDocumentError("AI 준비 재요청 중 연결 문제가 생겼어요."); }
    finally { setDocumentLoading(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("먼저 CSV 파일을 선택해주세요.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(".csv 파일을 선택해주세요.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("파일은 1MB 이하여야 합니다.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    setLoading(true);
    setReport(null);
    setDraft("");
    setError("");
    setAiError("");
    setAiUsage(null);
    try {
      const response = await authenticatedFetch("/api/report", { method: "POST", body: form });
      const data: Report | ApiError = await response.json();
      if (!response.ok) {
        const detail = (data as ApiError).detail;
        setError(Array.isArray(detail) ? detail.join(" / ") : detail ?? "분석 중 오류가 났어요.");
        return;
      }
      const nextReport = data as Report;
      setReport(nextReport);
      const lines = nextReport.branches.map(
        (row) => `- ${row.branch}: ${money(row.previous_amount)} → ${money(row.current_amount)} (변화 ${row.change > 0 ? "+" : ""}${money(row.change)})`,
      );
      setDraft(
        [`매출 보고서 초안 (${nextReport.previous_month} → ${nextReport.current_month})`, "", ...lines, "", "※ 위 숫자는 업로드한 CSV를 코드로 계산한 결과입니다. 변화의 원인은 확인 후 작성하세요."].join("\n"),
      );
    } catch {
      setError("화면 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  function downloadDraft() {
    if (!report) return;
    const blob = new Blob(["\uFEFF", draft], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workbrief-${report.current_month}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function generateAiDraft() {
    if (!file || !report) return;
    const form = new FormData();
    form.append("file", file);
    setAiLoading(true);
    setAiError("");
    setAiUsage(null);
    try {
      const response = await authenticatedFetch("/api/report?ai=1", { method: "POST", body: form });
      const data: AIReport | ApiError = await response.json();
      if (!response.ok) {
        const detail = (data as ApiError).detail;
        setAiError(Array.isArray(detail) ? detail.join(" / ") : detail ?? "AI 초안 생성에 실패했어요.");
        return;
      }
      const result = data as AIReport;
      setDraft(result.draft);
      setAiUsage(result.usage);
      await refreshUsageHistory();
    } catch {
      setAiError("AI 요청 중 연결 문제가 생겼어요.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <main id="top" className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900 sm:py-20">
      <div className="workbrief-shell mx-auto max-w-4xl">
        <header className="workbrief-hero">
          <div className="brand-bar"><a className="brand" href="#top" aria-label="WorkBrief 홈"><span className="brand-mark">W</span><span>workbrief<span className="brand-dot">.</span></span></a><span className="brand-caption">YOUR AI WORKSPACE</span><a className="account-link" href="#account">{user ? user.display_name + " 님" : "로그인"} <span>↗</span></a></div>
          <div className="hero-content"><div><p className="eyebrow"><span className="status-dot" /> A LITTLE MORE CLARITY, EVERY DAY</p><h1>일의 복잡함은 덜고,<br /><span>생각에 집중하세요.</span></h1><p className="hero-description">흩어진 문서와 데이터를 한곳에.<br />WorkBrief가 필요한 답을 함께 찾아드릴게요.</p></div><div className="hero-art" aria-hidden="true"><div className="orb orb-outer"><div className="orb orb-mid"><div className="orb orb-inner"><span>W</span></div></div></div><span className="hero-art-label">WORK SMARTER<br />THINK CLEARER&nbsp; ↗</span></div></div>
          <nav className="workspace-tabs" aria-label="업무 공간 선택">
            <button type="button" aria-pressed={workspace === "agent"} onClick={() => setWorkspace("agent")}><span>01</span> AI 도우미 <b>↗</b></button>
            <button type="button" aria-pressed={workspace === "knowledge"} onClick={() => setWorkspace("knowledge")}><span>02</span> 문서 검색 <b>↗</b></button>
            <button type="button" aria-pressed={workspace === "report"} onClick={() => setWorkspace("report")}><span>03</span> 매출 분석 <b>↗</b></button>
          </nav>
        </header>

        <section id="account" className="workbrief-auth mb-8 rounded-2xl border border-sky-100 bg-white p-6 shadow-sm">
          {user ? (
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-sky-800">{user.display_name}님, 로그인됨</p><p className="mt-1 text-xs text-slate-500">{user.email} · 로그인 출입증은 이 브라우저 탭을 닫으면 사라져요.</p></div><button type="button" onClick={logout} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">로그아웃</button></div>
          ) : (
            <><div className="flex gap-2"><button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${authMode === "login" ? "bg-sky-600 text-white" : "bg-slate-100"}`}>로그인</button><button type="button" onClick={() => { setAuthMode("register"); setAuthError(""); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${authMode === "register" ? "bg-sky-600 text-white" : "bg-slate-100"}`}>회원가입</button></div><form onSubmit={submitAuth} className="mt-4 grid gap-3 sm:grid-cols-2"><input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="이메일" type="email" required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />{authMode === "register" && <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="이름 (2~30자)" required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />}<input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="비밀번호 (10자 이상)" type="password" minLength={10} required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /><button disabled={authLoading} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{authLoading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입"}</button></form>{authError && <p className={`mt-3 text-sm ${authError.startsWith("회원가입이 완료") ? "text-emerald-700" : "text-rose-700"}`}>{authError}</p>}</>
          )}
        </section>

        {usageHistory && workspace === "report" && (
          <section aria-label="AI 사용량 누적" className="workbrief-usage mb-8 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
            <h2 className="font-bold">AI 사용량 누적</h2>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-slate-500">초안 생성</p><p className="mt-1 font-semibold">{usageHistory.summary.calls}회</p></div>
              <div><p className="text-xs text-slate-500">전체 토큰</p><p className="mt-1 font-semibold">{usageHistory.summary.total_tokens.toLocaleString("ko-KR")}개</p></div>
              <div><p className="text-xs text-slate-500">예상 누적 비용</p><p className="mt-1 font-semibold">${usageHistory.summary.estimated_cost_usd.toFixed(6)}</p></div>
            </div>
            {usageHistory.recent.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium text-indigo-700">최근 호출 {usageHistory.recent.length}건 보기</summary>
                <ul className="mt-3 space-y-2 text-slate-600">
                  {usageHistory.recent.map((item, index) => (
                    <li key={`${item.created_at}-${index}`} className="flex flex-wrap justify-between gap-x-4 border-t border-slate-100 pt-2">
                      <span>{new Date(item.created_at).toLocaleString("ko-KR")} · {item.model}</span>
                      <span>{item.total_tokens.toLocaleString("ko-KR")} 토큰 · ${(item.estimated_cost_usd ?? 0).toFixed(6)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-3 text-xs text-slate-400">숫자 사용 기록만 PostgreSQL에 저장돼요. CSV 내용과 API 키는 저장하지 않습니다.</p>
          </section>
        )}

        <section id="agent" hidden={workspace !== "agent"} className="workbrief-agent mb-8 rounded-2xl border border-amber-100 bg-white p-6 shadow-sm sm:p-8">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">YOUR AI ASSISTANT</span>
          <h2 className="mt-4 text-xl font-bold">무엇을 도와드릴까요?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">AI가 질문을 보고 매출 보고서 조회 또는 업무 문서 검색 중 필요한 도구를 골라 답해요. 데이터 수정 도구는 주지 않았어요.</p>
          <form onSubmit={askWorkAgent} className="mt-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input value={agentQuestion} onChange={(event) => setAgentQuestion(event.target.value)}
                placeholder="예: 강남점 매출은 지난달보다 얼마나 달라졌어?"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-amber-500" />
              <button type="submit" disabled={agentLoading}
                className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:bg-slate-300">
                {agentLoading ? "도구 선택 중..." : "업무 도우미에게 묻기"}
              </button>
            </div>
          </form>
          {agentError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{agentError}</p>}
          {agentHistory && (
            <details className="mt-4 rounded-lg border border-amber-100 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-amber-900">실행 기록 · 누적 {agentHistory.summary.calls}회 · {agentHistory.summary.total_tokens.toLocaleString("ko-KR")} 토큰 · ${agentHistory.summary.estimated_cost_usd.toFixed(6)}</summary>
              <ul className="mt-3 space-y-2 text-slate-700">
                {agentHistory.recent.map((trace, index) => (
                  <li key={`${trace.created_at}-${index}`} className="border-t border-amber-100 pt-2">
                    <p>{new Date(trace.created_at).toLocaleString("ko-KR")} · {trace.tools.map((tool) => tool === "get_sales_report" ? "매출 보고서 조회" : "업무 매뉴얼 검색").join(" → ")}</p>
                    <p className="mt-1 text-xs text-slate-500">{trace.model} · {trace.total_tokens.toLocaleString("ko-KR")} 토큰 · {trace.elapsed_ms}ms · ${(trace.estimated_cost_usd ?? 0).toFixed(6)}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-400">질문 원문과 문서 내용은 저장하지 않습니다.</p>
            </details>
          )}
          {agentAnswer && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold text-amber-700">업무 도우미 답변</p>
              <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-800">{agentAnswer.answer}</p>
              <div className="mt-4 border-t border-amber-200 pt-4 text-sm">
                <p className="font-semibold text-amber-900">AI가 사용한 도구</p>
                <ul className="mt-2 space-y-1 text-slate-700">
                  {agentAnswer.tool_trace.map((item, index) => (
                    <li key={`${item.tool}-${index}`}>{item.tool === "get_sales_report" ? "매출 보고서 조회" : "업무 매뉴얼 검색"}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-500">{agentAnswer.usage.total_tokens.toLocaleString("ko-KR")} 토큰 · 예상 비용 ${(agentAnswer.usage.estimated_cost_usd ?? 0).toFixed(6)}</p>
              </div>
            </div>
          )}
        </section>

        <section id="knowledge" hidden={workspace !== "knowledge"} className="workbrief-rag mb-8 rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">KNOWLEDGE · 문서 검색</span>
          <h2 className="mt-4 text-xl font-bold">문서에서 답을 찾다</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">문서를 등록하고 질문해 보세요. 관련 내용을 찾아 답변과 함께 근거를 보여드려요. 검색은 내 문서 전체를 대상으로 해요.</p>
          <form onSubmit={uploadDocument} className="mt-5">
            <label htmlFor="manual-file" className="block text-sm font-semibold">업무 매뉴얼 등록</label>
            <input id="manual-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={chooseDocument}
              className="mt-3 block w-full cursor-pointer rounded-lg border border-slate-200 p-2 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:font-semibold file:text-emerald-700" />
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="submit" disabled={documentLoading || !documentFile}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
                {documentLoading ? "등록 중..." : "문서 등록 후 AI 준비"}
              </button>
              <button type="button" onClick={refreshDocumentIndex} disabled={documentLoading || !documentId}
                className="rounded-lg border border-slate-400 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:border-slate-300 disabled:text-slate-400">
                AI 준비 상태 새로고침
              </button>
              {documentIndex && documentIndex.index_status !== "ready" && <button type="button" onClick={indexDocument} disabled={documentLoading}
                className="rounded-lg border border-violet-600 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:border-slate-300 disabled:text-slate-400">
                AI 준비 다시 요청
              </button>}
            </div>
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">내 업무 문서</p><button type="button" onClick={refreshDocuments} disabled={documentsLoading} className="text-xs font-semibold text-emerald-700">{documentsLoading ? "불러오는 중..." : "목록 새로고침"}</button></div>
              {storedDocuments.length === 0 ? <p className="mt-2 text-xs text-slate-500">아직 등록한 문서가 없어요.</p> : <ul className="mt-3 space-y-2">{storedDocuments.map((document) => <li key={document.document_id} className="flex gap-2"><button type="button" onClick={() => selectStoredDocument(document)} className={`flex min-w-0 flex-1 items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${documentId === document.document_id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className="min-w-0"><span className="block truncate font-medium">{document.filename}</span><span className="block text-xs text-slate-400">번호 {document.document_id} · {new Date(document.created_at).toLocaleString("ko-KR")}</span></span><span className={`ml-3 shrink-0 text-xs font-semibold ${document.index_status === "ready" ? "text-emerald-700" : document.index_status === "failed" ? "text-rose-700" : "text-amber-700"}`}>{document.index_status === "ready" ? "AI 준비 완료" : document.index_status === "failed" ? "준비 실패" : "AI 준비 중"}</span></button><button type="button" onClick={() => deleteStoredDocument(document)} className="rounded-lg border border-slate-400 px-3 text-sm text-slate-700" aria-label={`${document.filename} 번호 ${document.document_id} 삭제`}>삭제</button></li>)}</ul>}
            </div>
          </form>
          <form onSubmit={searchDocument} className="mt-6">
            <label htmlFor="document-question" className="block text-sm font-semibold">문서에 질문하기</label>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="radio" name="search-mode" checked={searchMode === "keyword"} onChange={() => setSearchMode("keyword")} /> 단어 검색</label>
              <label className="flex items-center gap-2"><input type="radio" name="search-mode" checked={searchMode === "semantic"} disabled={documentIndex?.index_status !== "ready"} onChange={() => setSearchMode("semantic")} /> 의미 검색 (AI) {documentIndex?.index_status !== "ready" && <span className="text-xs text-slate-400">준비 중</span>}</label>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input id="document-question" value={question} onChange={(event) => setQuestion(event.target.value)}
                placeholder="예: 취소 거래는 매출에서 어떻게 처리해?"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-emerald-500" />
              <button type="submit" disabled={documentLoading}
                className="rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:border-slate-300 disabled:text-slate-400">
                근거 찾기
              </button>
              <button type="button" onClick={createDocumentAnswer} disabled={documentLoading}
                className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-slate-300">
                {documentLoading ? "AI가 답변을 보내는 중..." : "AI 답변 만들기"}
              </button>
            </div>
          </form>
          {documentStatus && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{documentStatus}</p>}
          {documentError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{documentError}</p>}
          {documentAnswer && (
            <section aria-live="polite" className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-5">
              <p className="text-xs font-semibold text-violet-700">AI 답변 · {documentAnswer.mode === "semantic" ? "의미 검색" : "단어 검색"} 근거 사용</p>
              <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-800">{documentAnswer.answer || "AI가 근거를 읽고 답변을 쓰는 중이에요..."}</p>
              {documentAnswer.usage && (
                <p className="mt-3 text-xs text-slate-500">{documentAnswer.usage.total_tokens.toLocaleString("ko-KR")} 토큰 · 예상 비용 ${(documentAnswer.usage.estimated_cost_usd ?? 0).toFixed(6)}</p>
              )}
              {documentAnswer.sources.length > 0 && (
                <div className="mt-4 border-t border-violet-200 pt-4">
                  <p className="text-sm font-semibold text-violet-900">답변에 사용한 근거</p>
                  <ol className="mt-3 space-y-3">
                    {documentAnswer.sources.map((source, index) => (
                      <li key={`${source.document_name}-${source.chunk_index}`} className="rounded-lg border border-violet-100 bg-white p-4 text-sm">
                        <p className="font-semibold text-violet-800">근거 {documentAnswer.citations[index]} · {source.document_name} · 문단 조각 {source.chunk_index}</p>
                        <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-700">{source.content}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}
          {documentSearch && (
            <div className="mt-5">
              <h3 className="font-semibold">{documentSearch.mode === "semantic" ? "의미 검색" : "단어 검색"} 결과 · &quot;{documentSearch.query}&quot;</h3>
              {documentSearch.sources.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">찾은 근거가 없어요. 다른 표현으로 질문하거나 문서 내용을 확인해주세요.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {documentSearch.sources.map((source) => (
                    <li key={`${source.document_name}-${source.chunk_index}`} className="rounded-lg border border-slate-200 p-4 text-sm">
                      <p className="font-semibold text-emerald-800">{source.document_name} · 문단 조각 {source.chunk_index}</p>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-700">{source.content}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </section>

        <form id="report" hidden={workspace !== "report"} onSubmit={upload} className="workbrief-report-upload rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <label htmlFor="sales-file" className="block text-sm font-semibold">분석할 CSV 파일</label>
          <p className="mt-1 text-sm text-slate-500">거래일, 지점, 매출액, 거래ID 열이 있는 UTF-8 CSV · 1MB 이하</p>
          <input id="sales-file" type="file" accept=".csv,text/csv" onChange={chooseFile}
            className="mt-5 block w-full cursor-pointer rounded-lg border border-slate-200 p-2 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:font-semibold file:text-indigo-700" />
          <button type="submit" disabled={loading || !file}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {loading ? "분석 중..." : "매출 분석하기"}
          </button>
          {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
        </form>

        {report && workspace === "report" && (
          <>
          <section aria-live="polite" className="workbrief-report-result mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
              <h2 className="text-xl font-bold">지점별 결과</h2>
              <p className="mt-1 text-sm text-slate-500">{report.previous_month} → {report.current_month} · 변화 = 이번 달 − 지난달</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr><th scope="col" className="px-6 py-4 sm:px-8">지점</th><th scope="col" className="px-6 py-4 text-right">지난달</th><th scope="col" className="px-6 py-4 text-right">이번 달</th><th scope="col" className="px-6 py-4 text-right sm:px-8">변화</th></tr>
                </thead>
                <tbody>
                  {report.branches.map((row) => (
                    <tr key={row.branch} className="border-t border-slate-100">
                      <th scope="row" className="px-6 py-4 font-semibold sm:px-8">{row.branch}</th>
                      <td className="px-6 py-4 text-right tabular-nums">{money(row.previous_amount)}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{money(row.current_amount)}</td>
                      <td className={`px-6 py-4 text-right font-semibold tabular-nums sm:px-8 ${row.change > 0 ? "text-emerald-700" : row.change < 0 ? "text-rose-700" : "text-slate-500"}`}>
                        {row.change > 0 ? "+" : ""}{money(row.change)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="workbrief-draft mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-bold">보고서 초안</h2>
            <p className="mt-2 text-sm text-slate-500">AI 초안을 만들거나, 직접 문장을 고친 뒤 저장해봐. AI 호출에는 API 이용 요금이 들 수 있어.</p>
            <button type="button" onClick={generateAiDraft} disabled={aiLoading}
              className="mt-5 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300">
              {aiLoading ? "AI가 쓰는 중..." : "AI 초안 생성"}
            </button>
            {aiError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{aiError}</p>}
            {aiUsage && (
              <div className="mt-4 grid gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-950 sm:grid-cols-4">
                <div><p className="text-xs text-indigo-600">모델</p><p className="mt-1 font-semibold">{aiUsage.model}</p></div>
                <div><p className="text-xs text-indigo-600">사용 토큰</p><p className="mt-1 font-semibold">{aiUsage.total_tokens.toLocaleString("ko-KR")}개</p></div>
                <div><p className="text-xs text-indigo-600">걸린 시간</p><p className="mt-1 font-semibold">{(aiUsage.elapsed_ms / 1000).toFixed(2)}초</p></div>
                <div><p className="text-xs text-indigo-600">예상 API 비용</p><p className="mt-1 font-semibold">{aiUsage.estimated_cost_usd === null ? "가격표 미등록" : `$${aiUsage.estimated_cost_usd.toFixed(6)}`}</p></div>
              </div>
            )}
            <label htmlFor="report-draft" className="sr-only">보고서 초안 편집</label>
            <textarea id="report-draft" value={draft} onChange={(event) => setDraft(event.target.value)}
              rows={10} className="mt-5 w-full rounded-lg border border-slate-200 p-4 text-sm leading-7 outline-indigo-500" />
            <button type="button" onClick={downloadDraft}
              className="mt-4 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700">
              수정한 보고서 다운로드
            </button>
          </section>
          </>
        )}
      </div>
    </main>
  );
}
