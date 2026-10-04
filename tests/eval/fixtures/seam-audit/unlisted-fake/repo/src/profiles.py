class ProfileService:
    """Reads and writes display names through any Store."""

    def __init__(self, store):
        self._store = store

    def rename(self, user_id, name):
        self._store.put("name:" + user_id, name.strip())

    def display_name(self, user_id):
        return self._store.get("name:" + user_id) or "anonymous"
