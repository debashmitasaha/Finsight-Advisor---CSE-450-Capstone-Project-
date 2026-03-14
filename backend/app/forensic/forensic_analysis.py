import pandas as pd
import numpy as np
from scipy.stats import chisquare

# Benford's Law expected probabilities for digits 1-9
BENFORD_EXPECTED = {
    1: 0.301,
    2: 0.176,
    3: 0.125,
    4: 0.097,
    5: 0.079,
    6: 0.067,
    7: 0.058,
    8: 0.051,
    9: 0.046
}

def get_leading_digit(amount: float) -> int | None:
    """Extract the first significant digit from an amount."""
    if amount <= 0:
        return None
    first_digit = int(str(amount).replace('0', '').replace('.', '')[0])
    return first_digit

def benford_analysis(transactions: list[dict]) -> dict:
    """
    Run Benford's Law analysis on a list of transactions.
    Each transaction must have 'amount' and 'transaction_date'.
    Returns observed vs expected frequencies and flagged months.
    """
    df = pd.DataFrame(transactions)
    df['transaction_date'] = pd.to_datetime(df['transaction_date'])
    df['month'] = df['transaction_date'].dt.to_period('M').astype(str)
    df['leading_digit'] = df['amount'].apply(get_leading_digit)
    df = df.dropna(subset=['leading_digit'])
    df['leading_digit'] = df['leading_digit'].astype(int)

    results = {}
    flagged_months = []

    for month, group in df.groupby('month'):
        total = len(group)
        observed_counts = group['leading_digit'].value_counts().reindex(
            range(1, 10), fill_value=0
        )
        observed_freq = (observed_counts / total).round(3).to_dict()
        expected_freq = BENFORD_EXPECTED

        # Chi-square test
        observed_values = [observed_counts[d] for d in range(1, 10)]
        expected_values = [BENFORD_EXPECTED[d] * total for d in range(1, 10)]
        chi2, p_value = chisquare(observed_values, f_exp=expected_values)

        is_anomalous = p_value < 0.05

        results[month] = {
            "total_transactions": total,
            "observed_frequencies": observed_freq,
            "expected_frequencies": expected_freq,
            "chi2_statistic": round(chi2, 4),
            "p_value": round(p_value, 4),
            "is_anomalous": is_anomalous
        }

        if is_anomalous:
            flagged_months.append(month)

    return {
        "monthly_results": results,
        "flagged_months": flagged_months
    }
    
    
def zscore_analysis(transactions: list[dict]) -> dict:
    """
    Run Z-Score anomaly detection on transactions.
    Groups by (month, group) cohort and flags transactions
    where |z-score| > 2.5 and cohort size >= 5.
    """
    df = pd.DataFrame(transactions)
    df['transaction_date'] = pd.to_datetime(df['transaction_date'])
    df['month'] = df['transaction_date'].dt.to_period('M').astype(str)

    flagged_transactions = []

    for (month, group), cohort in df.groupby(['month', 'group']):
        if len(cohort) < 5:
            continue

        mean = cohort['amount'].mean()
        std = cohort['amount'].std()

        if std == 0:
            continue

        for _, row in cohort.iterrows():
            z = (row['amount'] - mean) / std
            if abs(z) > 2.5:
                flagged_transactions.append({
                    "transaction_date": str(row['transaction_date']),
                    "amount": row['amount'],
                    "group": group,
                    "month": month,
                    "z_score": round(z, 4),
                    "mean": round(mean, 4),
                    "std": round(std, 4)
                })

    return {
        "flagged_count": len(flagged_transactions),
        "flagged_transactions": flagged_transactions
    }
    
def rsf_analysis(transactions: list[dict]) -> dict:
    """
    Run Relative Size Factor analysis on transactions.
    RSF = transaction amount / median amount in (month, group) cohort.
    Flags transactions where RSF > 3.0.
    """
    df = pd.DataFrame(transactions)
    df['transaction_date'] = pd.to_datetime(df['transaction_date'])
    df['month'] = df['transaction_date'].dt.to_period('M').astype(str)

    flagged_transactions = []

    for (month, group), cohort in df.groupby(['month', 'group']):
        if len(cohort) < 2:
            continue

        median = cohort['amount'].median()

        if median == 0:
            continue

        for _, row in cohort.iterrows():
            rsf = row['amount'] / median
            if rsf > 3.0:
                flagged_transactions.append({
                    "transaction_date": str(row['transaction_date']),
                    "amount": row['amount'],
                    "group": group,
                    "month": month,
                    "rsf": round(rsf, 4),
                    "median": round(median, 4)
                })

    return {
        "flagged_count": len(flagged_transactions),
        "flagged_transactions": flagged_transactions
    }