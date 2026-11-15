export async function POST(request: Request) {
  try {
    const response = await fetch("http://127.0.0.1:8000/documents/answer/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
      body: JSON.stringify(await request.json()),
      cache: "no-store",
    });
    if (!response.ok) return Response.json(await response.json(), { status: response.status });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch {
    return Response.json({ detail: "Python 서버에 연결할 수 없어요. 8000번 서버가 켜져 있는지 확인해주세요." }, { status: 502 });
  }
}
