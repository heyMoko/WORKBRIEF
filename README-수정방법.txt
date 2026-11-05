WorkBrief RAG 검색 오류 수정

1. Python 서버와 Next.js 서버를 실행 중이면 각 터미널에서 Ctrl+C로 먼저 끕니다.

2. 이 ZIP 파일을 다운로드 폴더에 둡니다.

3. PowerShell에서 아래 한 줄을 실행합니다.

Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\workbrief-rag-search-fix.zip" -DestinationPath "C:\Users\moko\Desktop\dev\agent" -Force

4. Python 서버를 다시 켭니다.

cd C:\Users\moko\Desktop\dev\agent
.\.venv\Scripts\fastapi.exe dev api.py

5. 새 PowerShell 터미널에서 Next.js 화면을 다시 켭니다.

cd C:\Users\moko\Desktop\dev\agent\frontend
npm.cmd run dev

6. 브라우저에서 매뉴얼을 다시 등록한 뒤 질문합니다.

예: 취소 거래는 매출에서 어떻게 처리해?

무엇을 고쳤나?
- 화면이 보낸 질문 이름(q)과 Python 서버가 받는 이름(query)을 같게 했습니다.
- 서버 오류가 나더라도 [object Object]가 아니라 읽을 수 있는 문장으로 표시하게 했습니다.

이 수정은 API 키, CSV, 기존 workbrief.db를 건드리지 않습니다.
