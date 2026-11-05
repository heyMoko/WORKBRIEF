# WorkBrief RAG 1단계: 문서 검색 기준선

압축을 `C:\Users\moko\Desktop\dev\agent`에 풀어 기존 파일을 덮어쓰세요.

바뀌는 파일:
- `api.py`
- `test_api.py`
- `frontend\app\page.tsx`
- `frontend\app\api\documents\upload\route.ts`
- `frontend\app\api\documents\search\route.ts`
- `operations_manual.txt` (합성 업무 매뉴얼 예시)

Python 서버를 멈춘 후 적용합니다.

```powershell
Ctrl+C
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\workbrief-rag-baseline.zip" -DestinationPath "C:\Users\moko\Desktop\dev\agent" -Force
cd C:\Users\moko\Desktop\dev\agent
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\fastapi.exe dev api.py
```

정상 테스트 결과는 `24 passed`입니다. 같은 Python 터미널을 계속 사용하면 키를 다시 등록할 필요가 없습니다.

화면에서 `operations_manual.txt`를 **업무 매뉴얼 등록**에 올린 뒤, 아래 질문을 입력해보세요.

```text
취소 거래는 매출에서 어떻게 처리해?
```

관련 문단이 `operations_manual.txt · 문단 조각 2`처럼 나타납니다.

## 이번 단계에서 쓴 기술

- **SQLite**: 문서와 문단 조각을 작은 로컬 데이터베이스에 저장합니다. 현재 규모에서는 설치 없이 Python에 내장되어 있어 적합합니다.
- **청킹(chunking)**: 긴 문서를 약 500글자 이하의 작은 조각으로 나눕니다. 나중에 AI에 관련 조각만 줄 수 있어 비용과 혼선을 줄입니다.
- **단어 기반 검색**: 질문 단어와 겹치는 문단을 점수로 정렬합니다. 무료이고 결과를 이해하기 쉬워 임베딩 검색을 비교할 기준선으로 씁니다.
- **출처 표시**: 답변보다 먼저 근거를 보여줍니다. 다음 단계의 AI 답변이 근거 없는 말을 하지 않게 하는 안전장치입니다.

이 단계에서는 AI API를 호출하지 않습니다. 실제 고객 문서가 아닌 합성 예시 문서로 연습하세요.
