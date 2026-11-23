"""INTENTIONALLY BUGGY CLI used to test FThisUp."""
import argparse, json, sys

def main():
    p = argparse.ArgumentParser(prog="greet")
    p.add_argument("--name", default="world", help="who to greet <NAME>")
    p.add_argument("--config", help="path to a JSON config <FILE>")
    args = p.parse_args()
    cfg = {}
    if args.config:
        with open(args.config) as f:
            cfg = json.load(f)            # BUG: malformed/binary config -> uncaught traceback
    print(f"hello {cfg.get('prefix', '')}{args.name}")

if __name__ == "__main__":
    main()
