import unittest

from src.summary import status_summary


class TestStatusSummary(unittest.TestCase):
    def test_summary_shape(self):
        record = {"id": "job-7", "state": "done", "owner": "ops", "runs": [1, 2]}
        self.assertEqual(
            status_summary(record),
            {"id": "job-7", "state": "done", "done": True, "attempts": 2},
        )


if __name__ == "__main__":
    unittest.main()
