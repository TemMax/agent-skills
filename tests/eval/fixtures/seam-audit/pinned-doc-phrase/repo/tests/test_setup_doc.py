import pathlib
import unittest

DOC = pathlib.Path(__file__).resolve().parent.parent / "docs" / "setup.md"


class TestSetupDoc(unittest.TestCase):
    def test_init_step_is_documented(self):
        text = DOC.read_text()
        self.assertIn(
            "Run `python3 -m src.notes --init` once before adding your first note.",
            text,
        )


if __name__ == "__main__":
    unittest.main()
