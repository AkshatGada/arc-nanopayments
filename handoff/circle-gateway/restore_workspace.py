#!/usr/bin/env python3
"""Verify the handoff, then reconstruct the original workspace without network access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent


def sha256(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def verify_handoff():
    manifest = json.loads((HERE / 'HANDOFF_MANIFEST.json').read_text())
    actual = {p.relative_to(HERE).as_posix() for p in HERE.rglob('*') if p.is_file()}
    assert actual == set(manifest) | {'HANDOFF_MANIFEST.json', 'SHA256SUMS'}, 'Handoff file inventory differs'
    for name, expected in manifest.items():
        path = HERE / name
        assert not path.is_symlink() and sha256(path) == expected, f'Handoff hash mismatch: {name}'
    print(f'PASS handoff checksums: {len(manifest)} files')


def verify_workspace(destination):
    manifest = json.loads((HERE / 'WORKSPACE_MANIFEST.json').read_text())
    for name, expected in manifest.items():
        path = destination / name
        assert path.is_file() and not path.is_symlink(), f'Missing file: {name}'
        assert path.stat().st_size == expected['bytes'] and sha256(path) == expected['sha256'], f'Workspace hash mismatch: {name}'
        assert path.stat().st_mode & 0o111 == expected['mode'] & 0o111, f'Executable mode mismatch: {name}'
    for repo in json.loads((HERE / 'REPOSITORIES.json').read_text()):
        path = destination / repo['directory']
        head = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
        assert head == repo['head'], f'Research HEAD mismatch: {path}'
        assert not subprocess.check_output(['git', '-C', str(path), 'status', '--porcelain'], text=True).strip(), f'Dirty snapshot: {path}'
    print(f'PASS restored workspace: {len(manifest)} files and 8 exact research HEADs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', nargs='?', type=Path)
    parser.add_argument('--verify-only', action='store_true', help='Verify handoff; also verify destination if supplied')
    args = parser.parse_args()
    verify_handoff()
    if args.verify_only:
        if args.destination:
            verify_workspace(args.destination.resolve())
        return
    if args.destination is None:
        parser.error('Supply a NEW destination directory, or --verify-only')
    destination = args.destination.expanduser().resolve()
    if destination.exists():
        parser.error('Destination already exists; refusing to overwrite it')
    destination.mkdir(parents=True)
    shutil.copytree(HERE / 'workspace', destination, dirs_exist_ok=True)
    for repo in json.loads((HERE / 'REPOSITORIES.json').read_text()):
        path = destination / repo['directory']
        path.mkdir()
        archive = HERE / repo['archive']
        assert sha256(archive) == repo['archive_sha256']
        with tarfile.open(archive) as stream:
            for member in stream.getmembers():
                assert member.name == '.git' or member.name.startswith('.git/'), 'Unexpected snapshot member'
                assert not member.issym() and not member.islnk(), 'Snapshot links are not supported'
            # Python >=3.12 data filtering rejects absolute paths and traversal.
            stream.extractall(path, filter='data')
        subprocess.run(['git', '-C', str(path), 'checkout-index', '--all'], check=True)
    verify_workspace(destination)
    print(f'Restored: {destination}')
    print('No keys, signatures, dependencies, payments, RPC requests, or live services were restored or executed.')


if __name__ == '__main__':
    main()
