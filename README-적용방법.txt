WorkBrief Git 시작 전 보안 설정

이 ZIP 파일을 C:\Users\moko\Desktop\dev\agent 폴더에 압축 해제하세요.

PowerShell 명령어:

Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\workbrief-gitignore.zip" -DestinationPath "C:\Users\moko\Desktop\dev\agent" -Force

그 다음 아래 명령으로 실제로 제외되는 파일을 확인합니다.

cd C:\Users\moko\Desktop\dev\agent
git init
git add .
git status

목록에 .venv, frontend/node_modules, frontend/.next, workbrief.db가 없으면 정상입니다.
API 키를 .env 파일에 쓴 적이 없다면 현재 PowerShell 환경변수의 키는 Git에 포함되지 않습니다.
