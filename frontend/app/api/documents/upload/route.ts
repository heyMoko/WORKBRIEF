export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ detail: "문서를 선택해주세요." }, { status: 400 });
  }

  const forwarded = new FormData();
  forwarded.append("file", file, file.name);
  try {
    const response = await fetch("http://127.0.0.1:8000/documents/upload", {
      method: "POST",
      headers: { Authorization: request.headers.get("authorization") ?? "" },
      body: forwarded,
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
