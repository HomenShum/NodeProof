# research.md

Research grounding for this pack:

- World Models: agents benefit from compact spatial and temporal representations that support simulation before action. https://arxiv.org/abs/1803.10122
- Generative Agents: believable behavior uses observation, memory, reflection, planning, and action. https://arxiv.org/abs/2304.03442
- LangChain context engineering: agents need the right information at the right lifecycle step. https://docs.langchain.com/oss/python/langchain/context-engineering
- Anthropic effective agents: reliable agents need clear success criteria, feedback loops, and human oversight. https://www.anthropic.com/engineering/building-effective-agents
- Anthropic context engineering: long-running agents need curated context, not raw transcript stuffing. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

ProofLoop adapts these ideas to verification: world state is proof state, memory is receipts, and feedback is deterministic gates plus external scorer output.

