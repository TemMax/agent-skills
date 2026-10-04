import argparse
import os

DEFAULT_DIR = os.path.expanduser("~/.notes")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="notes")
    parser.add_argument("--init", action="store_true", help="create the notes directory")
    parser.add_argument("text", nargs="?", help="note text to append")
    args = parser.parse_args(argv)
    if args.init:
        os.makedirs(DEFAULT_DIR, exist_ok=True)
        print(f"created {DEFAULT_DIR}")
        return 0
    if not args.text:
        parser.error("nothing to add")
    with open(os.path.join(DEFAULT_DIR, "notes.txt"), "a") as fh:
        fh.write(args.text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
