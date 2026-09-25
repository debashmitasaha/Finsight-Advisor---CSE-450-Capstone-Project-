"""Historical full-population anomaly mining.

The row-level engine in the parent package answers "is this row unusual?". Over a
five-year ledger that is the wrong question: the rows that matter most are often
individually unremarkable, and scoring every one of them produces a list nobody
can work through.

This package answers the auditor's question instead: across the company's whole
history, what anomaly *cases* exist, when did they happen, which transactions
belong to them, how much money is involved, and why are they unusual?

Nothing here replaces the four views. They stay exactly as they are and their
output becomes one more source of evidence inside a case.

Phase 1 (this build): multi-resolution aggregates, rolling and seasonal
baselines, entity-period outliers, change points, collective microclusters,
materiality, the case builder and the case ranker. Autoencoder, sequence and
dynamic-graph views are deliberately left out until this layer earns its place.
"""

from app.forensic_engine.historical.types import Evidence, HistoricalConfig

__all__ = ["Evidence", "HistoricalConfig"]
