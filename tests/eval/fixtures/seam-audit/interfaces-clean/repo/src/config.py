def load_name(config: dict) -> str:
    return str(config.get("name", "app"))
