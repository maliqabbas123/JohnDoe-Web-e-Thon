# Documentation

| Document | What it covers | Standard |
|---|---|---|
| [Architecture](architecture.md) | Goals, constraints, context, containers, components, runtime flows, deployment, assumptions | arc42 sections, C4 model diagrams |
| [Data model](data-model.md) | Entity-relationship diagram, state models, integrity rules, assumptions, data dictionary | ER diagram and data dictionary |
| [API reference](openapi.yaml) | Every built endpoint with request and response schemas, plus notes for the UI team | OpenAPI 3.1 |
| [API plan](api.md) | Conventions, the full planned endpoint catalogue, contract for the exam page | REST conventions |
| [Security](security.md) | Assets, trust boundaries, threat model, control mapping, privacy, known gaps | STRIDE, OWASP Top 10 (2021) |
| [Read performance](performance.md) | Measured read times at volume, what was changed and why, rules for new modules | Measure, explain, fix, re-measure |
| [Testing](testing.md) | Test levels, how the end-to-end run works, required cases per module, CI | Test strategy |
| [Decision records](adr/README.md) | Why each significant choice was made | Architecture Decision Records |

Diagrams are written in Mermaid and render on the repository host. The entity-relationship diagram is also kept on its own in [`diagrams/erd.mmd`](diagrams/erd.mmd).
