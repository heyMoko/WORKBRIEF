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
type DocumentUpload = { document_id: number; filename: string; chunks: number };
type DocumentIndex = { document_id: number; indexed_chunks: number; model: string };
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

  function logout() { sessionStorage.removeItem("workbrief_access_token"); setUser(null); setDocumentSearch(null); setDocumentAnswer(null); setAgentAnswer(null); setAgentHistory(null); setUsageHistory(null); setReport(null); setDraft(""); setDocumentId(null); setDocumentStatus(""); }

  async function refreshUsageHistory() {
    try {
      const response = await authenticatedFetch("/api/report", { cache: "no-store" });
      if (response.ok) setUsageHistory((await response.json()) as UsageHistory);
    } catch {
      // 통계 화면을 불러오지 못해도 CSV 분석과 초안 작성은 계속 쓸 수 있다.
    }
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
      setDocumentStatus(`'${result.filename}' 문서를 ${result.chunks}개 조각으로 등록했어요. 키워드 검색은 바로 쓸 수 있어요.`);
      setDocumentSearch(null);
      setDocumentAnswer(null);
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
    try {
      const response = await authenticatedFetch("/api/documents/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, mode: searchMode }),
      });
      const data: DocumentAnswer | ApiError = await response.json();
      if (!response.ok) {
        setDocumentError(errorMessage(data as ApiError, "AI 답변 생성에 실패했어요."));
        return;
      }
      setDocumentAnswer(data as DocumentAnswer);
      setDocumentSearch(null);
    } catch {
      setDocumentError("AI 답변 생성 중 연결 문제가 생겼어요.");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function indexDocument() {
    if (!documentId) {
      setDocumentError("먼저 문서를 등록해주세요.");
      return;
    }
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const response = await authenticatedFetch(`/api/documents/${documentId}/index`, { method: "POST" });
      const data: DocumentIndex | ApiError = await response.json();
      if (!response.ok) {
        setDocumentError(errorMessage(data as ApiError, "의미 검색 준비에 실패했어요."));
        return;
      }
      const result = data as DocumentIndex;
      setSearchMode("semantic");
      setDocumentStatus(`${result.indexed_chunks}개 문단 조각을 의미 좌표로 저장했어요. 이제 의미 검색을 사용할 수 있어요.`);
    } catch {
      setDocumentError("의미 검색 준비 중 연결 문제가 생겼어요.");
    } finally {
      setDocumentLoading(false);
    }
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
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900 sm:py-20">
      <div className="workbrief-shell mx-auto max-w-4xl">
        <header className="workbrief-hero mb-8">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">WORKBRIEF · 첫 번째 화면</span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">매출 CSV, 한눈에 비교하기</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">두 달의 지점별 매출을 올리면 증가하거나 줄어든 금액을 바로 보여줘요.</p>
        <nav className="workbrief-nav"><a href="#report">매출 분석</a><a href="#knowledge">업무 매뉴얼</a><a href="#agent">AI 도우미</a></nav></header>

        <section id="account" className="workbrief-auth mb-8 rounded-2xl border border-sky-100 bg-white p-6 shadow-sm">
          {user ? (
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-sky-800">{user.display_name}님, 로그인됨</p><p className="mt-1 text-xs text-slate-500">{user.email} · 로그인 출입증은 이 브라우저 탭을 닫으면 사라져요.</p></div><button type="button" onClick={logout} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">로그아웃</button></div>
          ) : (
            <><div className="flex gap-2"><button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${authMode === "login" ? "bg-sky-600 text-white" : "bg-slate-100"}`}>로그인</button><button type="button" onClick={() => { setAuthMode("register"); setAuthError(""); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${authMode === "register" ? "bg-sky-600 text-white" : "bg-slate-100"}`}>회원가입</button></div><form onSubmit={submitAuth} className="mt-4 grid gap-3 sm:grid-cols-2"><input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="이메일" type="email" required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />{authMode === "register" && <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="이름 (2~30자)" required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />}<input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="비밀번호 (10자 이상)" type="password" minLength={10} required className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /><button disabled={authLoading} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{authLoading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입"}</button></form>{authError && <p className={`mt-3 text-sm ${authError.startsWith("회원가입이 완료") ? "text-emerald-700" : "text-rose-700"}`}>{authError}</p>}</>
          )}
        </section>

        {usageHistory && (
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

        <section id="agent" className="workbrief-agent mb-8 rounded-2xl border border-amber-100 bg-white p-6 shadow-sm sm:p-8">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Agent · Tool Calling</span>
          <h2 className="mt-4 text-xl font-bold">업무 도우미에게 질문하기</h2>
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

        <section id="knowledge" className="workbrief-rag mb-8 rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">RAG 3단계 · 근거 기반 AI 답변</span>
          <h2 className="mt-4 text-xl font-bold">업무 매뉴얼에서 근거 찾기</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">문서를 등록하고 질문을 입력하면 관련 문단을 찾고, AI가 그 문단만 근거로 짧게 답해요. 답변 아래에서 사용한 근거를 확인할 수 있어요.</p>
          <form onSubmit={uploadDocument} className="mt-5">
            <label htmlFor="manual-file" className="block text-sm font-semibold">업무 매뉴얼 등록</label>
            <input id="manual-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={chooseDocument}
              className="mt-3 block w-full cursor-pointer rounded-lg border border-slate-200 p-2 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:font-semibold file:text-emerald-700" />
            <button type="submit" disabled={documentLoading || !documentFile}
              className="mt-3 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
              {documentLoading ? "등록 중..." : "문서 등록"}
            </button>
            <button type="button" onClick={indexDocument} disabled={documentLoading || !documentId}
              className="mt-3 ml-3 rounded-lg border border-violet-600 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:border-slate-300 disabled:text-slate-400">
              의미 검색 준비 (AI)
            </button>
          </form>
          <form onSubmit={searchDocument} className="mt-6">
            <label htmlFor="document-question" className="block text-sm font-semibold">매뉴얼에 질문하기</label>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="radio" name="search-mode" checked={searchMode === "keyword"} onChange={() => setSearchMode("keyword")} /> 단어 검색</label>
              <label className="flex items-center gap-2"><input type="radio" name="search-mode" checked={searchMode === "semantic"} onChange={() => setSearchMode("semantic")} /> 의미 검색 (AI)</label>
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
                {documentLoading ? "답변 생성 중..." : "AI 답변 만들기"}
              </button>
            </div>
          </form>
          {documentStatus && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{documentStatus}</p>}
          {documentError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{documentError}</p>}
          {documentAnswer && (
            <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-5">
              <p className="text-xs font-semibold text-violet-700">AI 답변 · {documentAnswer.mode === "semantic" ? "의미 검색" : "단어 검색"} 근거 사용</p>
              <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-800">{documentAnswer.answer}</p>
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

        <form id="report" onSubmit={upload} className="workbrief-report-upload rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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

        {report && (
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
