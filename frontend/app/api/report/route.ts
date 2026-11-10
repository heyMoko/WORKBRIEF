export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ detail: "CSV 파일을 선택해주세요." }, { status: 400 });
  }

  const forwarded = new FormData();
  forwarded.append("file", file, file.name);
  try {
    const ai = new URL(request.url).searchParams.has("ai");
    const endpoint = ai ? "/report/upload/ai" : "/report/upload";
    const response = await fetch(`http://127.0.0.1:8000${endpoint}`, {
      method: "POST",
      headers: { Authorization: request.headers.get("authorization") ?? "" },
      body: forwarded,
      cache: "no-store",
    });
    const result = await response.json();
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { detail: "Python 서버에 연결할 수 없어요. 8000번 서버가 켜져 있는지 확인해주세요." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const response = await fetch("http://127.0.0.1:8000/report/usage", { headers: { Authorization: request.headers.get("authorization") ?? "" }, cache: "no-store" });
    const result = await response.json();
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { detail: "Python 서버에 연결할 수 없어요. 8000번 서버가 켜져 있는지 확인해주세요." },
      { status: 502 },
    );
  }
}
