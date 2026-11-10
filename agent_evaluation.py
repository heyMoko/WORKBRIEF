"""A small, repeatable exam for WorkBrief tool selection."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentEvaluationCase:
    """One question and the read-only tool the agent should choose first."""

    name: str
    question: str
    expected_tool: str


AGENT_EVALUATION_CASES = (
    AgentEvaluationCase("지점 증감", "강남점 매출은 지난달보다 얼마나 달라졌어?", "get_sales_report"),
    AgentEvaluationCase("전체 매출 비교", "이번 달과 지난달 지점별 매출을 비교해줘.", "get_sales_report"),
    AgentEvaluationCase("취소 처리", "당일에 취소된 거래는 매출에서 어떻게 처리해?", "search_work_documents"),
    AgentEvaluationCase("환불 기록", "이전 달 결제를 이번 달에 환불하면 어느 달에 기록해?", "search_work_documents"),
)


def evaluate_tool_selection(agent_function):
    """Run each question and return a score without deciding correctness ourselves."""
    results = []
    for case in AGENT_EVALUATION_CASES:
        result = agent_function(case.question)
        actual_tool = result["tool_trace"][0]["tool"] if result["tool_trace"] else None
        results.append(
            {
                "name": case.name,
                "expected_tool": case.expected_tool,
                "actual_tool": actual_tool,
                "passed": actual_tool == case.expected_tool,
            }
        )
    passed = sum(result["passed"] for result in results)
    return {"passed": passed, "total": len(results), "results": results}


if __name__ == "__main__":
    # This is deliberately separate from pytest because it calls the real model and costs credits.
    from api import run_work_agent

    evaluation = evaluate_tool_selection(run_work_agent)
    print(f"Agent tool-selection evaluation: {evaluation['passed']}/{evaluation['total']} passed")
    for result in evaluation["results"]:
        status = "PASS" if result["passed"] else "FAIL"
        print(f"{status} | {result['name']} | expected={result['expected_tool']} | actual={result['actual_tool']}")
