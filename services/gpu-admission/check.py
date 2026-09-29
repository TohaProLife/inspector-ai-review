#!/usr/bin/env python3
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_FLOOR
import json
import os
import subprocess
import sys


class AdmissionError(RuntimeError):
    pass


def parse_fraction(value: str) -> Decimal:
    try:
        fraction = Decimal(value)
    except InvalidOperation as error:
        raise AdmissionError("GPU_ADMISSION_FRACTION must be decimal") from error
    if not Decimal("0") < fraction <= Decimal("1"):
        raise AdmissionError("GPU_ADMISSION_FRACTION must be within (0, 1]")
    return fraction


def parse_budgets(value: str) -> dict[str, int]:
    try:
        raw = json.loads(value)
    except json.JSONDecodeError as error:
        raise AdmissionError("GPU_SERVICE_BUDGETS_MIB must be valid JSON") from error
    if not isinstance(raw, dict) or not raw:
        raise AdmissionError("GPU_SERVICE_BUDGETS_MIB must be a non-empty object")
    budgets: dict[str, int] = {}
    for name, budget in raw.items():
        if not isinstance(name, str) or not name:
            raise AdmissionError("GPU budget names must be non-empty strings")
        if not isinstance(budget, int) or isinstance(budget, bool) or budget <= 0:
            raise AdmissionError(f"GPU budget for {name} must be a positive integer")
        budgets[name] = budget
    return budgets


def admitted(total_mib: int, fraction: Decimal, budgets: dict[str, int], used_mib: int = 0) -> int:
    if total_mib <= 0 or used_mib < 0:
        raise AdmissionError("GPU memory values are invalid")
    cap_mib = int((Decimal(total_mib) * fraction).to_integral_value(rounding=ROUND_FLOOR))
    requested_mib = sum(budgets.values())
    if requested_mib > cap_mib:
        raise AdmissionError(
            f"declared GPU budgets exceed admission cap: {requested_mib} MiB > {cap_mib} MiB"
        )
    if used_mib + requested_mib > cap_mib:
        raise AdmissionError(
            "GPU is not empty enough for this profile: "
            f"used {used_mib} MiB + requested {requested_mib} MiB > cap {cap_mib} MiB"
        )
    return cap_mib


def query_gpu(device: str) -> tuple[int, int]:
    command = [
        "nvidia-smi",
        "--query-gpu=memory.total,memory.used",
        "--format=csv,noheader,nounits",
    ]
    try:
        output = subprocess.check_output(command, text=True, stderr=subprocess.STDOUT, timeout=15)
        visible = [line for line in output.splitlines() if line.strip()]
        if len(visible) != 1:
            raise AdmissionError(f"expected exactly one visible GPU, found {len(visible)}")
        values = [int(item.strip()) for item in visible[0].split(",")]
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError) as error:
        raise AdmissionError(f"cannot query GPU {device} with nvidia-smi: {error}") from error
    if len(values) != 2:
        raise AdmissionError(f"unexpected nvidia-smi output: {output!r}")
    return values[0], values[1]


def main() -> int:
    try:
        device = os.getenv("GPU_DEVICE", "0")
        fraction = parse_fraction(os.getenv("GPU_ADMISSION_FRACTION", "0.85"))
        budgets = parse_budgets(os.environ["GPU_SERVICE_BUDGETS_MIB"])
        minimum = int(os.getenv("GPU_MIN_TOTAL_MIB", "78000"))
        total_mib, used_mib = query_gpu(device)
        if total_mib < minimum:
            raise AdmissionError(
                f"GPU {device} has {total_mib} MiB, server profile requires at least {minimum} MiB"
            )
        cap_mib = admitted(total_mib, fraction, budgets, used_mib)
    except (AdmissionError, KeyError, ValueError) as error:
        print(f"GPU admission denied: {error}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": "admitted",
                "device": device,
                "totalMiB": total_mib,
                "usedMiB": used_mib,
                "capMiB": cap_mib,
                "requestedMiB": sum(budgets.values()),
                "budgetsMiB": budgets,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
