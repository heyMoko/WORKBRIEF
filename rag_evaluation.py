"""Fixed questions used to measure whether document retrieval finds the right evidence."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RetrievalEvaluationCase:
    """One question and the sentence that must appear in the top search result."""

    name: str
    question: str
    expected_phrase: str


EVALUATION_MANUAL = """# WorkBrief 가맹점 운영 매뉴얼

## 매출 집계 기준

매출 보고서에는 결제가 완료된 거래만 포함합니다. 거래일은 결제가 완료된 날짜를 기준으로 기록합니다. 주문 번호인 거래ID는 같은 거래가 두 번 들어오는지 확인하는 데 사용합니다.

## 취소와 환불 처리

당일에 취소된 거래는 매출에서 제외합니다. 이전 달 결제를 이번 달에 환불한 경우에는 환불이 확정된 달의 조정 항목으로 기록하고, 원래 거래ID와 함께 확인합니다. 환불 사유는 매출 숫자만으로 추정하지 않습니다.

## 월간 보고서 검토

운영 담당자는 매월 첫 영업일에 전월 매출을 비교합니다. 금액이 줄어든 지점은 행사 종료, 영업일 수, 재고 상황 등 별도 운영 자료를 확인한 뒤 보고서에 원인을 작성합니다.

## 데이터 오류 처리

매출액이 비어 있거나 거래ID가 없는 행은 자동으로 고치지 않습니다. 오류 목록에 표시하고 원본 시스템 담당자에게 수정 요청을 보냅니다. 같은 거래ID가 반복되면 중복 여부를 확인합니다.
"""


RETRIEVAL_EVALUATION_CASES = (
    RetrievalEvaluationCase(
        name="당일 취소",
        question="당일에 취소된 거래는 어떻게 처리해?",
        expected_phrase="당일에 취소된 거래는 매출에서 제외합니다.",
    ),
    RetrievalEvaluationCase(
        name="이전 달 결제 환불",
        question="이전 달 결제를 이번 달에 환불하면 어느 달에 기록해?",
        expected_phrase="환불이 확정된 달의 조정 항목으로 기록",
    ),
    RetrievalEvaluationCase(
        name="비어 있는 매출액",
        question="매출액이 비어 있으면 어떻게 처리해?",
        expected_phrase="자동으로 고치지 않습니다.",
    ),
    RetrievalEvaluationCase(
        name="반복 거래 ID",
        question="거래ID가 반복되면 무엇을 확인해?",
        expected_phrase="중복 여부를 확인합니다.",
    ),
)
