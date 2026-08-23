from __future__ import annotations

from collections import Counter, defaultdict
from itertools import combinations

import networkx as nx
import pandas as pd

from app.forensic_engine.config import EngineConfig
from app.forensic_engine.features import EntityBaseline
from app.forensic_engine.signals import Signal, ramp


VIEW = "relational"


def run(
    frame: pd.DataFrame,
    baselines: dict[str, dict[str, EntityBaseline]],
    config: EngineConfig,
) -> tuple[list[Signal], dict]:
    """Relationship forensics over the structure the ledger actually carries.

    The literature's canonical graph is vendor-employee-approver. This ledger has no such
    columns, so rather than fabricate them the view is built on the relation that is
    genuinely present: a voucher binds several account heads into one posting. Heads that
    habitually travel together form communities, and a payment that breaks the habitual
    pattern is the relational anomaly worth surfacing.

    `_ENTITY_LINKS` is where vendor/employee edges attach the day those columns exist.
    """
    signals: list[Signal] = []
    positive = frame[frame["amount"] > 0]
    if positive.empty:
        return signals, {"graph": "skipped", "reason": "no positive rows"}

    graph, voucher_map = _build_cooccurrence_graph(frame, config)
    if graph.number_of_nodes() == 0:
        return signals, {"graph": "skipped", "reason": "no multi-line vouchers to relate heads"}

    signals += _rare_pairing(frame, graph, voucher_map, config)
    signals += _spend_concentration(positive, config)
    signals += _hub_dominance(positive, graph, config)

    communities = _communities(graph)
    return signals, {
        "graph": "built",
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "vouchers": len(voucher_map),
        "communities": len(communities),
        "largest_community": max((len(c) for c in communities), default=0),
        "relation": "account heads co-posted on the same voucher",
    }


def _build_cooccurrence_graph(frame: pd.DataFrame, config: EngineConfig) -> tuple[nx.Graph, dict[str, list[str]]]:
    """Weighted graph of account heads that share a voucher."""
    voucher_map: dict[str, list[str]] = defaultdict(list)
    for row in frame.itertuples():
        voucher = row.invoice_id
        if voucher:
            voucher_map[voucher].append(row.entity_account_head)

    graph = nx.Graph()
    for voucher, heads in voucher_map.items():
        unique = sorted(set(heads))
        if len(unique) < config.min_voucher_lines:
            continue
        graph.add_nodes_from(unique)
        for left, right in combinations(unique, 2):
            if graph.has_edge(left, right):
                graph[left][right]["weight"] += 1
            else:
                graph.add_edge(left, right, weight=1)
    return graph, dict(voucher_map)


def _communities(graph: nx.Graph) -> list[set[str]]:
    if graph.number_of_edges() == 0:
        return []
    try:
        return list(nx.community.greedy_modularity_communities(graph))
    except Exception:
        return [set(component) for component in nx.connected_components(graph)]


def _rare_pairing(
    frame: pd.DataFrame,
    graph: nx.Graph,
    voucher_map: dict[str, list[str]],
    config: EngineConfig,
) -> list[Signal]:
    """A voucher joining heads that essentially never appear together.

    Routine postings reuse the same combinations month after month. A one-off pairing of
    two otherwise well-connected heads is the ledger equivalent of an unfamiliar
    counterparty relationship.
    """
    signals: list[Signal] = []

    voucher_count = len(voucher_map)
    if voucher_count < config.min_vouchers_for_rarity:
        # With only a handful of vouchers almost every pairing is technically a first, so
        # the test would fire on nearly every row and mean nothing.
        return signals

    pair_support: Counter = Counter()
    head_support: Counter = Counter()
    for heads in voucher_map.values():
        unique = sorted(set(heads))
        for head in unique:
            head_support[head] += 1
        for pair in combinations(unique, 2):
            pair_support[pair] += 1

    rows_by_voucher: dict[str, list] = defaultdict(list)
    for row in frame.itertuples():
        if row.invoice_id:
            rows_by_voucher[row.invoice_id].append(row)

    for voucher, rows in rows_by_voucher.items():
        heads = sorted({row.entity_account_head for row in rows})
        if len(heads) < 2:
            continue

        rare_pairs = []
        for pair in combinations(heads, 2):
            observed = pair_support.get(pair, 0)
            if observed > config.rare_pair_max_support:
                continue
            # Expected co-occurrences if the two heads were posted independently. Only
            # when we would have expected to see them together — and did not — is their
            # sudden pairing informative rather than an artefact of a sparse ledger.
            expected = head_support[pair[0]] * head_support[pair[1]] / voucher_count
            if expected < config.rare_pair_min_expected:
                continue
            rare_pairs.append((pair, expected))

        if not rare_pairs:
            continue

        # Scale by how surprising the strongest absence is.
        top_pair, top_expected = max(rare_pairs, key=lambda item: item[1])
        strength = ramp(top_expected, config.rare_pair_min_expected, config.rare_pair_min_expected * 6) * 0.7
        if strength <= 0:
            continue
        rare_pair_keys = [pair for pair, _ in rare_pairs]

        for row in rows:
            if not any(row.entity_account_head in pair for pair in rare_pair_keys):
                continue
            signals.append(
                Signal(
                    row.transaction_id,
                    VIEW,
                    "rare_account_pairing",
                    strength,
                    f"Voucher {voucher} pairs '{top_pair[0]}' with '{top_pair[1]}', which have never been posted together "
                    f"despite {top_expected:.1f} expected co-postings",
                    {
                        "voucher": voucher,
                        "rare_pairs": [list(pair) for pair in rare_pair_keys[:5]],
                        "heads_on_voucher": heads[:10],
                        "expected_cooccurrences": round(top_expected, 2),
                        "observed_cooccurrences": 0,
                        "voucher_population": voucher_count,
                    },
                )
            )
    return signals


def _spend_concentration(frame: pd.DataFrame, config: EngineConfig) -> list[Signal]:
    """One head absorbing most of a group's spend."""
    signals: list[Signal] = []

    for group_key, group in frame.groupby("entity_account_group"):
        if group_key in ("", "ungrouped") or group["entity_account_head"].nunique() < 3:
            continue
        totals = group.groupby("entity_account_head")["amount"].sum().sort_values(ascending=False)
        group_total = float(totals.sum())
        if group_total <= 0:
            continue

        top_head = totals.index[0]
        share = float(totals.iloc[0]) / group_total
        if share < config.concentration_share:
            continue

        strength = ramp(share, config.concentration_share, 0.95) * 0.6
        if strength <= 0:
            continue

        # Attach to the largest rows of the dominating head; those are what a reviewer
        # would open first.
        dominant_rows = group[group["entity_account_head"] == top_head].nlargest(5, "amount")
        for row in dominant_rows.itertuples():
            signals.append(
                Signal(
                    row.transaction_id,
                    VIEW,
                    "spend_concentration",
                    strength,
                    f"'{top_head}' absorbs {share:.0%} of all spend in group '{group_key}'",
                    {
                        "account_group": group_key,
                        "dominant_head": top_head,
                        "share_of_group": round(share, 4),
                        "group_total": round(group_total, 2),
                        "heads_in_group": int(group["entity_account_head"].nunique()),
                    },
                )
            )
    return signals


def _hub_dominance(frame: pd.DataFrame, graph: nx.Graph, config: EngineConfig) -> list[Signal]:
    """Heads sitting at unusual structural positions in the posting network.

    High betweenness means a head is the bridge through which otherwise separate parts of
    the ledger connect — a useful place to hide a payment, because it looks normal from
    either side.
    """
    signals: list[Signal] = []
    if graph.number_of_nodes() < 5:
        return signals

    try:
        betweenness = nx.betweenness_centrality(graph, weight="weight")
    except Exception:
        return signals

    if not betweenness:
        return signals

    ranked = sorted(betweenness.values())
    cutoff = ranked[int(len(ranked) * 0.95)] if len(ranked) > 20 else max(ranked)
    if cutoff <= 0:
        return signals

    bridges = {head for head, score in betweenness.items() if score >= cutoff}
    if not bridges:
        return signals

    p90 = float(frame["amount"].quantile(0.90))
    for row in frame[frame["entity_account_head"].isin(bridges)].itertuples():
        if row.amount < p90:
            continue
        strength = ramp(betweenness[row.entity_account_head] / cutoff, 1.0, 3.0) * 0.5
        if strength <= 0:
            continue
        signals.append(
            Signal(
                row.transaction_id,
                VIEW,
                "structural_bridge_payment",
                strength,
                f"Large payment through '{row.entity_account_head}', a bridge node linking otherwise separate parts of the posting network",
                {
                    "account_head": row.entity_account_head,
                    "betweenness": round(float(betweenness[row.entity_account_head]), 5),
                    "amount": float(row.amount),
                    "graph_degree": int(graph.degree(row.entity_account_head)),
                },
            )
        )
    return signals
