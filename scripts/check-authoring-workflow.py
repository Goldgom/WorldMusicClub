#!/usr/bin/env python3
"""Parse the complete focused workflow as YAML before running its commands.

CI installs PyYAML==6.0.3 explicitly. This checker never executes workflow code.
Use '-' to validate stdin; --json exposes the parsed document to contract tests.
"""
import argparse
import json
from pathlib import Path
import re
import sys

import yaml


class WorkflowLoader(yaml.SafeLoader):
    """Preserve GitHub's 'on' key instead of YAML 1.1's boolean spelling."""


WorkflowLoader.yaml_implicit_resolvers = {
    key: [(tag, pattern) for tag, pattern in resolvers
          if tag != 'tag:yaml.org,2002:bool']
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
WorkflowLoader.add_implicit_resolver(
    'tag:yaml.org,2002:bool', re.compile(r'^(?:true|false|True|False|TRUE|FALSE)$'),
    list('tTfF'))


def unique_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in result
        except TypeError as error:
            raise ValueError('Workflow mapping keys must be scalar') from error
        if duplicate:
            raise ValueError(f'Duplicate workflow mapping key: {key!r}')
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


WorkflowLoader.add_constructor('tag:yaml.org,2002:map', unique_mapping)


def parse_workflow(source):
    document = yaml.load(source, Loader=WorkflowLoader)
    if not isinstance(document, dict) or not isinstance(document.get('jobs'), dict):
        raise ValueError('Workflow must contain a jobs mapping')
    run_count = 0

    def inspect(value, location):
        nonlocal run_count
        if isinstance(value, dict):
            for key, child in value.items():
                child_location = f'{location}.{key}'
                if key == 'run':
                    if not isinstance(child, str) or not child.strip():
                        raise ValueError(f'{child_location}: run must be a nonempty string')
                    run_count += 1
                inspect(child, child_location)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                inspect(child, f'{location}[{index}]')

    inspect(document, 'workflow')
    if not run_count:
        raise ValueError('Workflow must contain executable run strings')
    return document, run_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workflow', nargs='?', default=str(
        Path(__file__).resolve().parents[1] / '.github/workflows/authoring-conversion-preview.yml'))
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    try:
        source = sys.stdin.read() if args.workflow == '-' else Path(args.workflow).read_text(encoding='utf-8')
        document, count = parse_workflow(source)
        print(json.dumps(document) if args.json else f'Authoring workflow YAML parsed; {count} run strings checked')
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f'Invalid authoring workflow: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
