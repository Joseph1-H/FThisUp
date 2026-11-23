"""A correct CLI."""
import argparse, json, sys

def main():
    p = argparse.ArgumentParser(prog="greet")
    p.add_argument("--name", default="world", help="who to greet <NAME>")
    p.add_argument("--config", help="path to a JSON config <FILE>")
    args = p.parse_args()
    cfg = {}
    if args.config:
        try:
            with open(args.config, encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, ValueError) as e:
            print(f"greet: cannot use config: {type(e).__name__}", file=sys.stderr)
            sys.exit(2)
    print(f"hello {cfg.get('prefix', '')}{args.name}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
