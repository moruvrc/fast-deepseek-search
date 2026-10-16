"""Compatibility runner for the current offline editor regression tests."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('editor-smoke.py')),run_name='__main__')
