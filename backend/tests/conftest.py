"""API checks use disposable storage, keeping the user's datasets untouched."""
import os
import tempfile
from pathlib import Path
import pytest

_temporary = tempfile.TemporaryDirectory(prefix='mybi-tests-')
_root = Path(_temporary.name)
os.environ['DATABASE_URL'] = 'sqlite:///' + (_root / 'metadata.db').as_posix()
os.environ['SNAPSHOT_ROOT'] = str(_root / 'snapshots')

@pytest.fixture(scope='session', autouse=True)
def clean_test_storage():
    yield
    from app.db import engine
    engine.dispose()
    _temporary.cleanup()
