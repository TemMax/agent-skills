def status_summary(record):
    """Summarize one status record for the dashboard API."""
    return {
        "id": record["id"],
        "state": record["state"],
        "done": record["state"] == "done",
        "attempts": len(record.get("runs", [])),
    }
