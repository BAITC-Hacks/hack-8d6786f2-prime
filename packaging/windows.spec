# Only public resources are included. Local .env and SQL databases are never bundled.
from pathlib import Path

root = Path(SPECPATH).parent
a = Analysis(
    [str(root / "run.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[(str(root / "frontend/dist"), "frontend/dist"),
           (str(root / "data/contractors.csv"), "data")],
    hiddenimports=["uvicorn.logging", "uvicorn.loops.asyncio", "uvicorn.protocols.http.h11_impl",
                   "uvicorn.lifespan.on"],
    excludes=["pytest", "tkinter", "backend.tests"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Start", debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="SatContractors")
