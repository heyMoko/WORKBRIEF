from agent_evaluation import AGENT_EVALUATION_CASES, evaluate_tool_selection


def test_agent_evaluation_scores_correct_tool_choices():
    def fake_agent(question):
        case = next(case for case in AGENT_EVALUATION_CASES if case.question == question)
        return {"tool_trace": [{"tool": case.expected_tool}]}

    evaluation = evaluate_tool_selection(fake_agent)

    assert evaluation["passed"] == 4
    assert evaluation["total"] == 4
    assert all(result["passed"] for result in evaluation["results"])


def test_agent_evaluation_marks_wrong_tool_choice_as_failure():
    evaluation = evaluate_tool_selection(
        lambda question: {"tool_trace": [{"tool": "get_sales_report"}]}
    )

    assert evaluation["passed"] == 2
    assert evaluation["results"][2]["passed"] is False
