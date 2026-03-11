from langgraph.graph import StateGraph, START, END
from agent.state import AgentState
from agent.nodes import (
    analyze_gap,
    rewrite_bullets,
    validate_changes,
    generate_doc,
    generate_analytics,
)
from utils.logger import get_logger

logger = get_logger(__name__)


def create_tailoring_graph():
    # 1. Define the graph
    workflow = StateGraph(AgentState)

    # 2. Add nodes
    workflow.add_node("analyze_gap", analyze_gap)
    workflow.add_node("rewrite_bullets", rewrite_bullets)
    workflow.add_node("validate_changes", validate_changes)
    workflow.add_node("generate_doc", generate_doc)
    workflow.add_node("generate_analytics", generate_analytics)

    # 3. Add edges
    workflow.add_edge(START, "analyze_gap")
    workflow.add_edge("analyze_gap", "rewrite_bullets")
    workflow.add_edge("rewrite_bullets", "validate_changes")
    workflow.add_edge("validate_changes", "generate_doc")
    workflow.add_edge("generate_doc", "generate_analytics")
    workflow.add_edge("generate_analytics", END)

    # 4. Compile the graph
    return workflow.compile()


# Singleton instance
tailoring_app = create_tailoring_graph()
