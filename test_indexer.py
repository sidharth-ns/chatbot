"""Smoke test for the PageIndex indexer pipeline."""

import json
import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.indexer import index_markdown_file, scan_directory, count_nodes, has_heading_structure
from config.settings import SAMPLE_DOCS_DIR


def main():
    print(f"Sample docs dir: {SAMPLE_DOCS_DIR}")
    print(f"Files found: {scan_directory(SAMPLE_DOCS_DIR)}")
    print()

    # Test single file
    test_file = os.path.join(SAMPLE_DOCS_DIR, "README.md")

    print(f"Has heading structure: {has_heading_structure(test_file)}")
    print(f"Indexing {test_file}...")
    print()

    result = index_markdown_file(
        test_file,
        progress_callback=lambda msg: print(f"  [{msg}]"),
    )

    tree = result["tree"]
    print(f"\n{'='*60}")
    print(f"doc_name: {tree.get('doc_name')}")
    print(f"line_count: {tree.get('line_count')}")
    print(f"doc_description: {tree.get('doc_description', 'N/A')}")
    print(f"total nodes: {count_nodes(tree)}")
    print(f"cached: {result['cached']}")
    print(f"{'='*60}\n")

    # Print tree structure (titles + summaries only)
    def print_tree(nodes, indent=0):
        for node in nodes:
            summary = node.get("summary") or node.get("prefix_summary", "")
            summary_str = f" -- {summary[:80]}..." if summary and len(summary) > 80 else f" -- {summary}" if summary else ""
            print(f"{'  ' * indent}[{node.get('node_id', '?')}] {node.get('title', '')}{summary_str}")
            if node.get("nodes"):
                print_tree(node["nodes"], indent + 1)

    print("TREE STRUCTURE:")
    print("-" * 60)
    print_tree(tree.get("structure", []))

    # Print full JSON (truncated strings)
    print(f"\n{'='*60}")
    print("FULL JSON (first 3000 chars):")
    print("=" * 60)
    full_json = json.dumps(tree, indent=2, ensure_ascii=False)
    print(full_json[:3000])
    if len(full_json) > 3000:
        print(f"\n... ({len(full_json)} total chars)")


if __name__ == "__main__":
    main()
