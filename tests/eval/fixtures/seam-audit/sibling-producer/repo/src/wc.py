import argparse
import sys


def count(text):
    return {"lines": len(text.splitlines()), "words": len(text.split()), "chars": len(text)}


def main(argv=None):
    parser = argparse.ArgumentParser(prog="wc", description="Count lines, words and characters.")
    parser.add_argument("path", help="file to count")
    args = parser.parse_args(argv)
    with open(args.path) as fh:
        counts = count(fh.read())
    for key in ("lines", "words", "chars"):
        print(f"{key}: {counts[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
