import unittest

from src.profiles import ProfileService
from tests.fakes import FakeStore


class ProfileServiceTest(unittest.TestCase):
    def test_rename_strips_whitespace(self):
        store = FakeStore()
        ProfileService(store).rename("u1", "  Ada ")
        self.assertEqual(store.data["name:u1"], "Ada")

    def test_unknown_user_is_anonymous(self):
        self.assertEqual(ProfileService(FakeStore()).display_name("u2"), "anonymous")


if __name__ == "__main__":
    unittest.main()
