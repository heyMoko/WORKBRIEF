export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch("http://127.0.0.1:8000/agent/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json(
      { detail: "Python 서버에 연결할 수 없어요. 8000번 서버가 켜져 있는지 확인해주세요." },
      { status: 502 },
    );
  }
}
