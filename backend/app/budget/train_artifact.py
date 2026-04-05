from __future__ import annotations

import argparse

from app.budget.forecasting import (
    build_monthly_series_from_dataframe,
    read_budget_training_data,
    save_forecast_artifact,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and save a serialized budget forecasting artifact.")
    parser.add_argument("--input", required=True, help="Path to a CSV or Excel file with transaction_date and Debit/amount columns.")
    parser.add_argument(
        "--artifact-name",
        required=True,
        help="Artifact directory name. Use the department ID here if you want the app to auto-load it for that department.",
    )
    parser.add_argument("--department-id", help="Optional department ID to store in artifact metadata.")
    parser.add_argument("--source-name", help="Optional label for where the training data came from.")
    args = parser.parse_args()

    frame = read_budget_training_data(args.input)
    monthly = build_monthly_series_from_dataframe(frame)
    artifact_dir = save_forecast_artifact(
        monthly,
        args.artifact_name,
        department_id=args.department_id,
        source_name=args.source_name or args.input,
    )

    print(f"Saved budget artifact to: {artifact_dir}")
    print("Use the artifact name as the department ID, or save it as 'default' to act as a global fallback.")


if __name__ == "__main__":
    main()
