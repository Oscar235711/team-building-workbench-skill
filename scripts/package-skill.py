"""Build and verify a Skill archive from a fixed source allowlist (stdlib only)."""
import argparse
import hashlib
import json
import re
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'team-building-workbench'
FILES = {
    'SKILL.md', 'agents/openai.yaml', 'references/inputs.md',
    'references/deployment.md', 'references/native-publishing.md',
    'scripts/create-workbench.mjs',
}
ASSETS = {
    '.gitignore', '.dockerignore', 'Dockerfile', 'package.json', 'package-lock.json',
    'public/index.html', 'public/app.js', 'public/style.css', 'public/cloud.js',
    'src/api.js', 'src/domain.js', 'src/sqlite.js', 'src/seed.js', 'src/web.js',
    'src/http-origin.js', 'scripts/local-server.mjs', 'scripts/backup.mjs',
    'scripts/build-worker.mjs', 'worker/index.js',
}


def sources():
    expected = FILES | {'assets/workbench/' + item for item in ASSETS}
    expected |= {
        item.relative_to(SKILL).as_posix()
        for item in (SKILL / 'assets/workbench/drizzle').glob('*.sql')
        if re.fullmatch(r'\d{4}_[a-z0-9_]+\.sql', item.name)
    }
    actual = set()
    for item in SKILL.rglob('*'):
        if item.is_symlink():
            raise ValueError('Source contains a symbolic link')
        if item.is_file():
            actual.add(item.relative_to(SKILL).as_posix())
    if actual != expected:
        raise ValueError('Source allowlist mismatch: ' + str(sorted(actual ^ expected)))
    return {name: (SKILL / name).read_bytes() for name in sorted(expected)}


def verify(archive, expected):
    entries, manifest = [], []
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError('ZIP contains missing, extra or duplicate entries')
        for info in package.infolist():
            name = info.filename
            if '\\' in name or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or ':' in name:
                raise ValueError('ZIP contains an unsafe path')
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('ZIP contains a symbolic link')
            content = package.read(info)
            if content != expected[name]:
                raise ValueError('ZIP does not match source: ' + name)
            entries.append({'name': name, 'content': content.decode('utf-8')})
            manifest.append({'path': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    # Audit the bytes read BACK from the archive, not just the working tree.
    audit = """import {auditEntry} from './scripts/audit-package.mjs';
let input='';for await(const c of process.stdin)input+=c;
const findings=JSON.parse(input).flatMap(e=>auditEntry(e.name,e.content));
console.log(JSON.stringify({findings}));if(findings.length)process.exitCode=1;"""
    result = subprocess.run(['node', '--input-type=module', '-e', audit],
                            input=json.dumps(entries, ensure_ascii=False), text=True,
                            encoding='utf-8', cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        raise ValueError('ZIP content audit failed: ' + result.stdout.strip())
    return {'archive': archive.name, 'entries': len(manifest),
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'findings': json.loads(result.stdout)['findings'], 'files': manifest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='1.0.2')
    parser.add_argument('--check', type=Path, help='Verify an existing archive without modifying it')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('Version must be major.minor.patch')
    expected = sources()
    archive = args.check.resolve() if args.check else ROOT / 'outputs' / f'team-building-workbench-v{args.version}.zip'
    if not args.check:
        archive.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            for name, content in expected.items():
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                package.writestr(info, content)
    report = verify(archive, expected)
    if not args.check:
        archive.with_suffix('.manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: report[key] for key in ('archive', 'entries', 'sha256', 'findings')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
