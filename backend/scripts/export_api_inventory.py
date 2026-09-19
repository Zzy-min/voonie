"""Export the FastAPI contract into a stable, reviewable JSON inventory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from voonie.backend.app.main import app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    schema = app.openapi()
    operations = []
    for path, methods in sorted(schema["paths"].items()):
        for method, operation in sorted(methods.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            operations.append({
                "method": method.upper(),
                "path": path,
                "operation_id": operation.get("operationId"),
                "summary": operation.get("summary"),
                "tags": operation.get("tags", []),
                "security": operation.get("security", []),
                "request_body": bool(operation.get("requestBody")),
                "responses": sorted(operation.get("responses", {}).keys()),
            })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"count": len(operations), "operations": operations}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Exported {len(operations)} operations to {output}")


if __name__ == "__main__":
    main()
