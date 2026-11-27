# Documentation

| Document | What it covers | Standard |
|---|---|---|
| [Architecture](architecture.md) | Goals, constraints, context, containers, components, runtime flows, deployment, assumptions | arc42 sections, C4 model diagrams |
| [Data model](data-model.md) | Entity-relationship diagram, state models, integrity rules, assumptions, data dictionary | ER diagram and data dictionary |
| [API](api.md) | Conventions, endpoint catalogue, contract for the exam page | REST conventions; OpenAPI 3.1 to follow |
| [Security](security.md) | Assets, trust boundaries, threat model, control mapping, privacy, known gaps | STRIDE, OWASP Top 10 (2021) |
| [Testing](testing.md) | Test levels, how the end-to-end run works, required cases per module, CI | Test strategy |
| [Decision records](adr/README.md) | Why each significant choice was made | Architecture Decision Records |

Diagrams are written in Mermaid and render on the repository host. The entity-relationship diagram is also kept on its own in [`diagrams/erd.mmd`](diagrams/erd.mmd).
