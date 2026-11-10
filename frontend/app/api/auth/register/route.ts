export async function POST(request: Request) {
  try {
    const response = await fetch("http://127.0.0.1:8000/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await request.json()), cache: "no-store" });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ detail: "Python 서버에 연결할 수 없어요." }, { status: 502 }); }
}
