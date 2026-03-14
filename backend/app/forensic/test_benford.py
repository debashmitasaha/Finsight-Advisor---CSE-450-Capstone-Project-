import pandas as pd
from forensic_analysis import benford_analysis

# Load the actual excel file
df = pd.read_excel("transaction_01-08-2022_to_05-08-2022.xlsx")

# Prepare transactions list - using Debit as amount
df = df[df['Debit'] > 0]  # only debit transactions
transactions = df.rename(columns={
    'Debit': 'amount',
    'transaction_date': 'transaction_date'
})[['amount', 'transaction_date']].to_dict(orient='records')

# Run benford analysis
result = benford_analysis(transactions)

print("Flagged Months:", result['flagged_months'])
print("\nMonthly Results:")
for month, data in result['monthly_results'].items():
    print(f"\n{month}:")
    print(f"  Total Transactions: {data['total_transactions']}")
    print(f"  Chi2: {data['chi2_statistic']}")
    print(f"  P-Value: {data['p_value']}")
    print(f"  Anomalous: {data['is_anomalous']}")
    
    
from forensic_analysis import zscore_analysis

# Prepare transactions with group column
transactions_with_group = df.rename(columns={
    'Debit': 'amount',
    'transaction_date': 'transaction_date',
    'account_head_group': 'group'
})[['amount', 'transaction_date', 'group']].to_dict(orient='records')

# Run zscore analysis
zscore_result = zscore_analysis(transactions_with_group)

print("\n--- Z-Score Analysis ---")
print(f"Total Flagged: {zscore_result['flagged_count']}")
for t in zscore_result['flagged_transactions']:
    print(f"\n  Date: {t['transaction_date']}")
    print(f"  Amount: {t['amount']}")
    print(f"  Group: {t['group']}")
    print(f"  Z-Score: {t['z_score']}")
    print(f"  Mean: {t['mean']}, Std: {t['std']}")
    
from forensic_analysis import rsf_analysis

# Run RSF analysis
rsf_result = rsf_analysis(transactions_with_group)

print("\n--- RSF Analysis ---")
print(f"Total Flagged: {rsf_result['flagged_count']}")
for t in rsf_result['flagged_transactions']:
    print(f"\n  Date: {t['transaction_date']}")
    print(f"  Amount: {t['amount']}")
    print(f"  Group: {t['group']}")
    print(f"  RSF: {t['rsf']}")
    print(f"  Median: {t['median']}")