"""Build a redistributable directory + ZIP from explicit, non-secret inputs."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "release")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Build the Windows package on Windows.")
    if not (ROOT / "frontend/dist/index.html").is_file():
        parser.error("Build the frontend first.")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    target = output / "SatContractors"
    archive = output / "SatContractors-Windows.zip"
    if target.exists() or archive.exists():
        parser.error("Output already exists. Use a new --output directory; existing releases are not overwritten.")
    with tempfile.TemporaryDirectory(prefix="sat-build-", dir=output) as temporary:
        subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                        "--distpath", str(output), "--workpath", temporary,
                        str(ROOT / "packaging/windows.spec")], cwd=ROOT, check=True)
    shutil.copyfile(ROOT / "packaging/READ-ME.txt", target / "READ-ME.txt")
    unexpected = [p for p in target.rglob("*") if p.is_file() and
                  (p.name == ".env" or p.suffix in {".sqlite3", ".db"} or p.name.endswith(("-wal", "-shm")))]
    if unexpected:
        raise RuntimeError("Refusing to package local configuration or SQL state")
    shutil.make_archive(str(archive.with_suffix("")), "zip", output, "SatContractors")
    print(archive)


if __name__ == "__main__":
    main()
