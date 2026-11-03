import importlib.metadata as metadata
import hashlib
from pathlib import Path
import shutil
import sys
import tomllib
import zipfile

from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts'
output.mkdir(exist_ok=True)
stage = output / 'MyBI-v1.0-Windows-x64'
if stage.exists():
    if stage.resolve().parent != output.resolve():
        raise ValueError('Release directory is outside artifacts')
    shutil.rmtree(stage)
stage.mkdir(exist_ok=False)
runtime = stage / 'runtime'
runtime.mkdir()
base = Path(sys.base_prefix)
for name in ('python.exe', 'python3.dll', f'python{sys.version_info.major}{sys.version_info.minor}.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt'):
    shutil.copy2(base / name, runtime / name)
shutil.copytree(base / 'DLLs', runtime / 'DLLs', ignore=shutil.ignore_patterns('__pycache__'))
shutil.copytree(base / 'Lib', runtime / 'Lib', ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'test', 'tests', 'idlelib', 'tkinter'))

pending = list(tomllib.loads((root / 'backend/pyproject.toml').read_text(encoding='utf-8'))['project']['dependencies'])
included = {}
available = {canonicalize_name(distribution.metadata['Name']): distribution for distribution in metadata.distributions() if distribution.metadata.get('Name') and distribution.files}
site = Path(sys.prefix) / 'Lib/site-packages'
while pending:
    requirement = Requirement(pending.pop())
    name = canonicalize_name(requirement.name)
    extras = set(requirement.extras)
    if name in included and extras <= included[name]:
        continue
    extras |= included.get(name, set())
    included[name] = extras
    distribution = available[name]
    for file in distribution.files or []:
        source = Path(distribution.locate_file(file)).resolve()
        if not source.is_relative_to(site.resolve()) or any(part in {'__pycache__', 'tests'} for part in source.parts) or source.suffix == '.pyc':
            continue
        target = runtime / 'Lib/site-packages' / source.relative_to(site.resolve())
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for dependency in distribution.requires or []:
        child = Requirement(dependency)
        if child.marker is None or any(child.marker.evaluate({'extra': extra}) for extra in extras | {''}):
            pending.append(str(child))

for name in ('MyBI.exe', 'run.bat', 'README.md'):
    shutil.copy2(root / name, stage / name)
shutil.copytree(root / 'backend/app', stage / 'backend/app', ignore=shutil.ignore_patterns('__pycache__'))
shutil.copy2(root / 'backend/pyproject.toml', stage / 'backend/pyproject.toml')
shutil.copytree(root / 'frontend/dist', stage / 'frontend/dist')
(stage / 'frontend/src/locales').mkdir(parents=True)
shutil.copy2(root / 'frontend/src/locales/en.json', stage / 'frontend/src/locales/en.json')
(stage / 'scripts').mkdir()
shutil.copy2(root / 'scripts/start-workbench.ps1', stage / 'scripts/start-workbench.ps1')
shutil.copytree(root / 'demo', stage / 'demo')
(stage / 'runtime-packages.txt').write_text('\n'.join(f'{name}=={available[name].version}' for name in sorted(included)) + '\n', encoding='utf-8')
checksums = []
for portable in (False, True):
    archive = output / (stage.name + ('-Portable' if portable else '') + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file in stage.rglob('*'):
            if file.is_file() and (portable or (not file.is_relative_to(runtime) and file.name != 'runtime-packages.txt')):
                bundle.write(file, file.relative_to(output))
    checksums.append(f'{hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()}  {archive.name}')
    print(f'Packaged {archive} ({archive.stat().st_size:,} bytes)')
(output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
