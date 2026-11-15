type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { documentId } = await params;
  try {
    const response = await fetch(`http://127.0.0.1:8000/documents/${encodeURIComponent(documentId)}/status`, {
      headers: { Authorization: request.headers.get("authorization") ?? "" },
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
